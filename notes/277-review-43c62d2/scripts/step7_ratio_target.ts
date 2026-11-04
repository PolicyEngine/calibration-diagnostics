// Step 7: a multi-fact target whose operation keeps the base fact's identity
// (scaled_by_ratio, ledger_targets.py:1018-1027 at 0ff293b). Microcosm writes
// the member metadata for every multi-fact reference (:1090, :1318-1340), with
// the base as the representative (:1232-1245). Here the FSA fixture's Alabama
// balance row stands in for a UK CGT Table 5 cell: same record and keys, plus
// the three members a ratio-scaled cell carries.
// Usage: bun run step7_ratio_target.ts <worktree>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const PKG = join(process.argv[2], "frontend/packages/calibration-tree/src");
const la = await import(join(PKG, "latest-artifact.ts"));
const fsa = JSON.parse(readFileSync(join(PKG, "fixtures/ed-fsa-family/ed-fsa-family-schema-8.json"), "utf8"));
const base = fsa.targets.find((r: any) => String(r.target_name).includes("borrower_location") && String(r.target_name).includes("dollars_outstanding") && r.metadata?.ledger_geography_name === "Alabama")
  ?? fsa.targets.find((r: any) => r.metadata?.ledger_geography_name === "Alabama");
const md = base.metadata;
const members = [md.ledger_fact_key, "ledger.aggregate_fact.v2:numerator000000000000000", "ledger.aggregate_fact.v2:denominator0000000000000"];
const row = structuredClone(base);
Object.assign(row.metadata, {
  ledger_value_operation: "scaled_by_ratio",
  ledger_member_fact_count: "3",
  ledger_member_fact_keys: JSON.stringify(members),
  ledger_member_aggregate_fact_keys: JSON.stringify(members),
});
const cal = la.buildCalibration({ ...fsa, targets: [row] }, "populace-us-2024", null, {}, {}, {}, "us");
const lookup = (key: string) => {
  const url = new URL("https://dashboard.test/api/microcosm/target-investigation");
  url.searchParams.set("target", key);
  const r = la.latestMicrocosmTargetInvestigation(url.toString(), cal);
  return r.available ? "found" : "not found";
};
const inv = (() => {
  const url = new URL("https://dashboard.test/api/microcosm/target-investigation");
  url.searchParams.set("target", String(row.name));
  return la.latestMicrocosmTargetInvestigation(url.toString(), cal);
})();
const c = inv.target.chronicle;
console.log(JSON.stringify({
  target: row.target_name,
  shown: { source_record_id: c.source_record_id, fact_key: c.fact_key, layout_groupby_value_id: c.layout_groupby_value_id,
    universe_constraint_set_key: c.universe_constraint_set_key, member_fact_count: c.member_fact_count },
  lookup_by_source_record_id: lookup(md.ledger_source_record_id),
  lookup_by_fact_key: lookup(md.ledger_fact_key),
  searches: inv.repo_searches.map((s: any) => s.label),
}, null, 1));
