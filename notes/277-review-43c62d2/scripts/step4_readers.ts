// Step 4: run the dashboard's readers on every calibration diagnostics
// fixture in the repo, at one worktree. Usage:
//   bun run step4_readers.ts <worktree> <outdir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const [W, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const PKG = join(W, "frontend/packages/calibration-tree/src");
const la = await import(join(PKG, "latest-artifact.ts"));
const { buildCalibrationTree } = await import(join(PKG, "calibration-tree.ts"));
const { createExplorerState, selectExplorerNode } = await import(join(PKG, "calibration-explorer.ts"));
const golden = await import(join(PKG, "test-support/calibration-tree-golden-cases.ts"));
const { schema9Diagnostics } = await import(join(PKG, "test-support/schema-9-diagnostics.ts"));

type J = Record<string, any>;
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const inputs: { name: string; build: () => any }[] = [];
for (const [name, input] of Object.entries(golden.goldenReleaseInputs() as Record<string, any>)) {
  inputs.push({
    name: `golden-${name}`,
    build: () => la.buildCalibration(JSON.parse(input.diagnosticsText), input.releaseId, null, {},
      input.releaseManifestText ? JSON.parse(input.releaseManifestText) : {}, {}, input.country),
  });
}
const zz = join(W, "frontend/lib/microcosm/fixtures/zz-release");
inputs.push({ name: "zz-release", build: () => la.buildCalibration(
  { ...json(join(zz, "calibration_diagnostics.json")), schema_version: 2 }, "microcosm-zz-2026-conformance",
  "2026-08-23T18:00:00Z", {}, json(join(zz, "release_manifest.json")), {}, "zz") });
inputs.push({ name: "us-legacy-target-identities", build: () => la.buildCalibration(
  JSON.parse(gunzipSync(readFileSync(join(PKG, "fixtures/us-legacy-target-identities.json.gz"))).toString("utf8")),
  "populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z") });
const be = join(PKG, "fixtures/be-release");
inputs.push({ name: "be-release-schema2", build: () => la.buildCalibration(
  { ...json(join(be, "calibration_diagnostics.json")), schema_version: 2 }, "microcosm-be-2024-national-golden",
  null, {}, json(join(be, "release_manifest.json")), {}, "be") });
for (const name of ["valid-uniform", "valid-unequal-custom-scales", "unavailable-warning", "malformed-partial"]) {
  inputs.push({ name: `loss-attribution-${name}`, build: () => la.buildCalibration(
    json(join(PKG, `fixtures/target-loss-attribution/${name}.json`)), `microcosm-uk-${name}`, null, {}, {}, {}, "uk") });
}
const fsa = json(join(PKG, "fixtures/ed-fsa-family/ed-fsa-family-schema-8.json"));
inputs.push({ name: "FSA-ed-fsa-family-schema-8", build: () => la.buildCalibration(fsa, "populace-us-2024", null, {}, {}, {}, "us") });
inputs.push({ name: "FSA-ed-fsa-family-schema-9", build: () => la.buildCalibration(schema9Diagnostics(fsa), "populace-us-2024", null, {}, {}, {}, "us") });

const page = (cal: any, q: Record<string, string>) => {
  const url = new URL("https://dashboard.test/api/microcosm/target-diagnostics");
  url.searchParams.set("limit", "500");
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  return la.latestMicrocosmTargetDiagnosticsPage(url.toString(), cal);
};
const safe = (f: () => any) => { try { return f(); } catch (e) { return { THREW: String(e) }; } };

const index: J = {};
for (const input of inputs) {
  const cal = safe(input.build);
  if (cal.THREW) { index[input.name] = cal; continue; }
  const out: J = { release_id: cal.release_id, n_rows: cal.rows.length };
  out.summary = safe(() => la.latestMicrocosmCalibrationSummary(cal));
  // Every page of the unfiltered list.
  const all: J[] = [];
  for (let offset = 0; ; offset += 500) {
    const p = page(cal, { offset: String(offset) });
    if (offset === 0) out.page_default = { ...p, targets: undefined };
    all.push(...p.targets);
    if (!p.has_next) break;
  }
  out.page_default_targets = all;
  const rows: J[] = cal.rows;
  const uniq = (f: (r: J) => unknown) => [...new Set(rows.map(f).filter(Boolean).map(String))].sort();
  const queries: Record<string, string>[] = [];
  for (const v of uniq((r) => r.variable_key)) queries.push({ variable: v });
  for (const s of uniq((r) => r.source)) queries.push({ source: s });
  for (const l of uniq((r) => r.level)) queries.push({ level: l });
  for (const g of uniq((r) => r.geography)) queries.push({ geography: g });
  for (const pair of uniq((r) => r.variable_key && r.level ? `${r.variable_key}\u0000${r.level}` : null)) {
    const [variable, level] = pair.split("\u0000"); queries.push({ variable, level });
  }
  for (const pair of uniq((r) => r.variable_key && r.geography ? `${r.variable_key}\u0000${r.geography}` : null)) {
    const [variable, geography] = pair.split("\u0000"); queries.push({ variable, geography });
  }
  queries.push({ scope: "healthcare" }, { include_families: "1" }, { within_tolerance: "false" });
  out.pages = Object.fromEntries(queries.map((q) => [JSON.stringify(q), safe(() => page(cal, q))]));
  const root = createExplorerState();
  out.tree_root = safe(() => buildCalibrationTree(cal.rows, root, cal.release_id));
  // Drill the calibration map breadth-first from the root, up to 80 states.
  out.tree_states = safe(() => {
    const seen: J = {};
    const queue: any[] = [root];
    while (queue.length && Object.keys(seen).length < 80) {
      const state = queue.shift();
      const key = JSON.stringify(state.path);
      if (key in seen) continue;
      const response = buildCalibrationTree(cal.rows, state, cal.release_id);
      seen[key] = response;
      for (const node of response.groups.flatMap((g: J) => g.nodes)) {
        if (node.selection && node.selection.kind !== "target") queue.push(selectExplorerNode(state, node.selection));
      }
    }
    return seen;
  });
  out.treemap_program = safe(() => la.microcosmTargetTreemap(cal.rows, cal.release_id));
  out.treemap_geography = safe(() => la.microcosmTargetTreemap(cal.rows, cal.release_id, "geography"));
  // Look up every target by its name and by each raw Chronicle key it carries.
  const lookups: J = {};
  for (const row of rows) {
    const chronicle = (row.chronicle ?? {}) as J;
    const keys = [row.name, row.base_name, chronicle.source_record_id, chronicle.fact_key,
      chronicle.semantic_fact_key, chronicle.aggregate_fact_key, chronicle.legacy_fact_key].filter(Boolean);
    for (const key of keys) {
      if (key in lookups) continue;
      const url = new URL("https://dashboard.test/api/microcosm/target-investigation");
      url.searchParams.set("target", String(key));
      lookups[key] = safe(() => la.latestMicrocosmTargetInvestigation(url.toString(), cal));
    }
  }
  out.investigations = lookups;
  out.comparison_self = safe(() => la.buildComparison(cal, cal));
  out.calibration_rows = rows;
  writeFileSync(join(OUT, `${input.name}.json`), JSON.stringify(out, null, 1));
  index[input.name] = { n_rows: out.n_rows, pages: queries.length, lookups: Object.keys(lookups).length };
}
writeFileSync(join(OUT, "_index.json"), JSON.stringify(index, null, 1));
console.log(JSON.stringify(index, null, 1));
