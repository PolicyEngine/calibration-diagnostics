/**
 * Release history CLI (calibration-diagnostics#224): plan, upload, finalize,
 * pull and timeline. The Python producer (`release_history/`) measures; this
 * script owns everything that touches Blob or the dashboard's release
 * inventory. It prints ids, statuses and timings only, never a figure.
 *
 *   bun run scripts/release-history.ts plan --country uk --root ../out --mode topup
 *   bun run scripts/release-history.ts upload --root ../out
 *   bun run scripts/release-history.ts finalize --country uk --root ../out --plan ../plan.json
 *   bun run scripts/release-history.ts pull --country uk --out ./release-history-uk
 *   bun run scripts/release-history.ts timeline --country uk --root ./release-history-uk
 */
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

import { readCalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-blob";
import {
  releaseDirectoryOf,
  type CalibrationTreeManifestEntry,
} from "@policyengine/calibration-tree/calibration-tree-manifest";
import { isCountry } from "@policyengine/calibration-tree/countries";
import { loadReleasesRecord } from "@policyengine/calibration-tree/latest-artifact";
import { recordedBuilds, type ReleasesRecord } from "@policyengine/calibration-tree/release-record";

import {
  buildTimeline,
  encodeDocument,
  finalizeCountry,
  panelPrefix,
  planPanel,
  putImmutable,
  putReplace,
  putWriteOnce,
  readJson,
  RELEASE_HISTORY_MANIFEST_PATH,
  RELEASE_HISTORY_PREFIX,
  seriesMatches,
  storedFileKind,
  updateManifestCountry,
  vercelBlobStore,
  type MeasurementDocument,
  type Plan,
  type PlanMode,
  type ReferencesLock,
  type ReleaseBuild,
  type ReleaseHistoryManifest,
  type ReleaseHistoryStore,
} from "../lib/microcosm/release-history-store";

/** The parts of the producer's panel.json this script reads. */
export interface PanelDocument {
  panel_id: string;
  country: string;
  created_at: string | null;
  release_repo: string;
  series: { releases: string[]; exclude: string[] };
  spec_sha256: string;
  producer: { version: string };
  engine: { policyengine: string; model: { name: string; version: string }; core: { name: string; version: string } };
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/** The one panel folder `release-history identity --out <root>` wrote for a country. */
export async function readLocalPanel(root: string, country: string): Promise<PanelDocument> {
  const countryDir = join(root, RELEASE_HISTORY_PREFIX, country);
  const panels: PanelDocument[] = [];
  for (const file of await walk(countryDir)) {
    if (file.endsWith("/panel.json")) panels.push(JSON.parse(await readFile(file, "utf8")));
  }
  if (panels.length !== 1) {
    throw new Error(`Expected one panel.json for ${country} under ${root}, found ${panels.length}.`);
  }
  return panels[0];
}

/** A panel's panel.json as the plan job uploaded it. */
export async function readStoredPanel(
  store: ReleaseHistoryStore,
  country: string,
  panelId: string,
): Promise<PanelDocument> {
  const panel = await readJson<PanelDocument>(store, `${panelPrefix(country, panelId)}panel.json`);
  if (!panel) throw new Error(`No panel.json for ${country} panel ${panelId}.`);
  return panel;
}

/**
 * The panel's series, as the dashboard's release picker lists releases.
 *
 * - **A repository with releases.json** (the UK since Microcosm's build folders): every build the
 *   record lists under the series' releases, named and read by its folder (`<release>/<build>`),
 *   dated by the record's `published_at`, at the commit the dashboard's tree manifest pins for
 *   it. A recorded build with no tree entry yet waits for a later run. The tree manifest also
 *   holds the cut tags each build was moved from and the bare release folder; they are not
 *   listed, because the record is Microcosm's own list of what is published.
 * - **A repository without one** (the US): the tree manifest's release entries by name.
 */
export function listSeries(
  panel: PanelDocument,
  entries: readonly CalibrationTreeManifestEntry[],
  latestBuildArtifactId: string | null,
  record: ReleasesRecord | null,
): ReleaseBuild[] {
  const repo = panel.release_repo.toLowerCase();
  const releases = entries.filter(
    (entry) => entry.kind === "release" && entry.releaseId && entry.hfRepo.toLowerCase() === repo,
  );
  if (record) {
    const byId = new Map(releases.map((entry) => [entry.releaseId as string, entry]));
    return recordedBuilds(record).flatMap((build): ReleaseBuild[] => {
      const entry = byId.get(build.id);
      if (!entry || !seriesMatches(panel.series, build.id, build.id)) return [];
      return [{
        releaseId: build.id,
        releaseDirectory: build.id,
        hfRepo: entry.hfRepo,
        hfCommitSha: entry.hfCommitSha,
        publishedAt: build.publishedAt,
        current: build.current && build.inDefaultRelease,
        withdrawn: build.withdrawn,
      }];
    });
  }
  return releases
    .map((entry): ReleaseBuild => ({
      releaseId: entry.releaseId as string,
      releaseDirectory: releaseDirectoryOf(entry) ?? (entry.releaseId as string),
      hfRepo: entry.hfRepo,
      hfCommitSha: entry.hfCommitSha,
      publishedAt: entry.updatedAt ?? entry.createdAt,
      current: entry.buildArtifactId === latestBuildArtifactId,
      withdrawn: false,
    }))
    .filter((build) => seriesMatches(panel.series, build.releaseDirectory, build.releaseId));
}

/** The country's published release builds in the panel's series, as the release picker lists them. */
export async function seriesBuilds(panel: PanelDocument, options: { token?: string } = {}): Promise<ReleaseBuild[]> {
  if (!isCountry(panel.country)) throw new Error(`${panel.country} is not a registered country.`);
  const { manifest } = await readCalibrationTreeManifest({ token: options.token, consistent: true });
  const country = manifest.countries[panel.country];
  // Null only when the repository has no releases.json. A record that can't be read stops the
  // plan: falling back to the tree manifest's names would list every moved cut twice.
  const record = await loadReleasesRecord(0, panel.country);
  return listSeries(panel, country?.builds ?? [], country?.latestReleaseBuildArtifactId ?? null, record);
}

export async function plan(options: {
  store: ReleaseHistoryStore;
  panel: PanelDocument;
  builds: ReleaseBuild[];
  mode: PlanMode;
  releaseId?: string | null;
}): Promise<Plan & { builds: ReleaseBuild[] }> {
  const manifest = await readJson<ReleaseHistoryManifest>(options.store, RELEASE_HISTORY_MANIFEST_PATH);
  const result = planPanel({
    country: options.panel.country,
    panelId: options.panel.panel_id,
    mode: options.mode,
    releaseId: options.releaseId,
    builds: options.builds,
    entry: manifest?.countries[options.panel.country],
  });
  return { ...result, builds: options.builds };
}

/** Upload a local store folder: points immutable, panel.json once, the rest replaced. */
export async function uploadDirectory(store: ReleaseHistoryStore, root: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const files = (await walk(join(root, RELEASE_HISTORY_PREFIX))).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const path = relative(root, file).split("\\").join("/");
    const kind = storedFileKind(path);
    if (!kind) continue;
    const body = encodeDocument(JSON.parse(await readFile(file, "utf8")));
    let outcome: string;
    if (kind === "measurement") outcome = await putImmutable(store, path, body);
    else if (kind === "panel") outcome = await putWriteOnce(store, path, body);
    else {
      await putReplace(store, path, body);
      outcome = "replaced";
    }
    counts[`${kind}:${outcome}`] = (counts[`${kind}:${outcome}`] ?? 0) + 1;
  }
  return counts;
}

async function storedMeasurements(store: ReleaseHistoryStore, country: string, panelId: string) {
  const paths = await store.list(panelPrefix(country, panelId));
  const documents: MeasurementDocument[] = [];
  for (const path of paths.filter((p) => storedFileKind(p) === "measurement").sort()) {
    const document = await readJson<MeasurementDocument>(store, path);
    if (document) documents.push(document);
  }
  return documents;
}

export async function finalize(options: {
  store: ReleaseHistoryStore;
  panel: PanelDocument;
  plan: Plan & { builds: ReleaseBuild[] };
  /** A run of the default branch's engine: it may move the pinned and served panels. */
  pin: boolean;
  at?: string;
}) {
  const { store, panel } = options;
  const at = options.at ?? now();
  const stored = await storedMeasurements(store, panel.country, panel.panel_id);
  const manifest = await updateManifestCountry(store, panel.country, (entry) =>
    finalizeCountry({
      entry,
      panel: {
        panelId: panel.panel_id,
        createdAt: panel.created_at,
        engine: {
          policyengine: panel.engine.policyengine,
          model: `${panel.engine.model.name}==${panel.engine.model.version}`,
          core: `${panel.engine.core.name}==${panel.engine.core.version}`,
        },
        specSha256: panel.spec_sha256,
        producerVersion: panel.producer.version,
      },
      builds: options.plan.builds,
      planned: options.plan.points,
      stored,
      pin: options.pin,
    }), at);
  const references = await readJson<ReferencesLock>(store, `${panelPrefix(panel.country, panel.panel_id)}references.json`);
  const timeline = buildTimeline({
    country: panel.country, panelId: panel.panel_id, points: stored, references, builtAt: at,
  });
  await putReplace(store, `${panelPrefix(panel.country, panel.panel_id)}timeline.json`, encodeDocument(timeline));
  const entry = manifest.countries[panel.country]!;
  const record = entry.panels[panel.panel_id];
  return {
    country: panel.country,
    panelId: panel.panel_id,
    current: entry.currentPanelId === panel.panel_id,
    complete: record.complete,
    points: Object.values(record.points).map((point) => ({
      releaseId: point.releaseId,
      state: point.state,
      measurementStatus: point.measurementStatus,
      attempts: point.attempts,
      withdrawn: point.withdrawn,
    })),
    series: timeline.series.length,
  };
}

/** Download a panel (the country's current one by default) into a local folder. */
export async function pull(options: { store: ReleaseHistoryStore; country: string; out: string; panelId?: string }) {
  const manifest = await readJson<ReleaseHistoryManifest>(options.store, RELEASE_HISTORY_MANIFEST_PATH);
  const entry = manifest?.countries[options.country];
  const panelId = options.panelId ?? entry?.currentPanelId ?? entry?.pinnedPanelId;
  if (!panelId) throw new Error(`No release history panel for ${options.country}.`);
  const paths = [RELEASE_HISTORY_MANIFEST_PATH, ...await options.store.list(panelPrefix(options.country, panelId))];
  for (const path of paths) {
    const found = await options.store.read(path);
    if (!found) continue;
    const target = join(options.out, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, found.body);
  }
  return { panelId, files: paths.length };
}

/** Build timeline.json from a local folder (local runs, or a pulled panel). */
export async function localTimeline(root: string, country: string, panelId: string): Promise<string> {
  const folder = join(root, panelPrefix(country, panelId));
  const points: MeasurementDocument[] = [];
  let references: ReferencesLock | null = null;
  for (const name of (await readdir(folder)).sort()) {
    const kind = storedFileKind(name);
    if (kind === "measurement") points.push(JSON.parse(await readFile(join(folder, name), "utf8")));
    if (kind === "references") references = JSON.parse(await readFile(join(folder, name), "utf8"));
  }
  const timeline = buildTimeline({ country, panelId, points, references, builtAt: now() });
  const target = join(folder, "timeline.json");
  await writeFile(target, encodeDocument(timeline));
  return target;
}

async function githubOutput(values: Record<string, string>): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  await appendFile(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

async function stepSummary(markdown: string): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, `${markdown}\n`);
}

function blobStore(): ReleaseHistoryStore {
  return vercelBlobStore(process.env.BLOB_READ_WRITE_TOKEN || undefined);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      country: { type: "string" },
      root: { type: "string" },
      out: { type: "string" },
      mode: { type: "string", default: "topup" },
      "release-id": { type: "string" },
      plan: { type: "string" },
      panel: { type: "string" },
      "plan-out": { type: "string" },
      "panel-id": { type: "string" },
      // finalize: set only for a run of the default branch's engine.
      pin: { type: "boolean", default: false },
    },
  });
  if (command === "plan") {
    const panel = await readLocalPanel(values.root!, values.country!);
    const result = await plan({
      store: blobStore(),
      panel,
      builds: await seriesBuilds(panel, { token: process.env.BLOB_READ_WRITE_TOKEN || undefined }),
      mode: values.mode as PlanMode,
      releaseId: values["release-id"] ?? null,
    });
    if (values["plan-out"]) await writeFile(values["plan-out"], encodeDocument(result));
    await githubOutput({
      action: result.action,
      count: String(result.points.length),
      panel_id: result.panelId,
      matrix: JSON.stringify({ point: result.points }),
      plan: JSON.stringify(result),
    });
    await stepSummary(
      `### Release history plan: ${result.country}\n\nPanel \`${result.panelId}\`, mode \`${result.mode}\`: ` +
        `${result.action} ${result.points.length} of ${result.seriesSize} series points` +
        (result.reason ? ` (${result.reason})` : "") + ".",
    );
    console.log(JSON.stringify({ ...result, builds: result.builds.length }));
  } else if (command === "upload") {
    console.log(JSON.stringify(await uploadDirectory(blobStore(), values.root!)));
  } else if (command === "finalize") {
    const store = blobStore();
    const panel = values.root
      ? await readLocalPanel(values.root, values.country!)
      : await readStoredPanel(store, values.country!, values["panel-id"]!);
    const planned = JSON.parse(await readFile(values.plan!, "utf8"));
    const summary = await finalize({ store, panel, plan: planned, pin: values.pin === true });
    const rows = summary.points
      .map((p) => `| ${p.releaseId} | ${p.state} | ${p.measurementStatus ?? ""} | ${p.attempts} |`)
      .join("\n");
    await stepSummary(
      `### Release history: ${summary.country}\n\nPanel \`${summary.panelId}\`: ` +
        `${summary.complete ? "complete" : "incomplete"}, ${summary.current ? "current" : "not current"}.\n\n` +
        `| Release | State | Measurement | Attempts |\n|---|---|---|---|\n${rows}`,
    );
    console.log(JSON.stringify(summary));
  } else if (command === "pull") {
    console.log(JSON.stringify(await pull({
      store: blobStore(), country: values.country!, out: values.out!, panelId: values.panel,
    })));
  } else if (command === "timeline") {
    console.log(JSON.stringify({ timeline: await localTimeline(values.root!, values.country!, values.panel!) }));
  } else {
    throw new Error("Usage: release-history.ts plan|upload|finalize|pull|timeline [options]");
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
