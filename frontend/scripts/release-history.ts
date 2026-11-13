/**
 * Release history CLI (calibration-diagnostics#224): plan, upload, finalize,
 * pull and timeline. The Python producer (`release_history/`) lists the
 * series and measures; this script owns everything that touches Blob. It
 * prints ids, statuses and counts only, never a figure.
 *
 *   bun run scripts/release-history.ts plan --country uk --root ../out --mode topup
 *   bun run scripts/release-history.ts upload --root ../out
 *   bun run scripts/release-history.ts finalize --country uk --panel-id <id> --plan ../plan.json
 *   bun run scripts/release-history.ts pull --country uk --out ./release-history-uk
 *   bun run scripts/release-history.ts timeline --country uk --root ./release-history-uk --panel <id>
 *
 * `plan` reads what `release-history identity --out` and `release-history
 * series --out` wrote under `--root`: the panel, and the series record listed
 * from the release repository's releases.json.
 *
 * Runs of the default branch's engine pin (`--pin`, given to plan, upload and
 * finalize alike). Only they replace the country's files (series record,
 * references, labels) and rebuild every panel's timeline; a run from another
 * ref uploads its own panel and points and rebuilds its own timeline only, so
 * an unmerged spec never reaches the served page.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

import {
  attemptPath,
  buildTimeline,
  countryFilePath,
  encodeDocument,
  finalizeCountry,
  listedBuilds,
  panelPrefix,
  PLAN_MODES,
  planPanel,
  putImmutable,
  putReplace,
  putWriteOnce,
  readJson,
  RELEASE_HISTORY_MANIFEST_PATH,
  RELEASE_HISTORY_PREFIX,
  storedFileKind,
  updateManifestCountry,
  vercelBlobStore,
  type AttemptReport,
  type LabelsDocument,
  type ManifestPoint,
  type MeasurementDocument,
  type Plan,
  type PlanMode,
  type ReferencesLock,
  type ReleaseHistoryManifest,
  type ReleaseHistoryStore,
  type SeriesRecord,
} from "../lib/microcosm/release-history-store";

/** The producer's panel.json (`engine.panel_document`): the panel key and what it hashes. */
export interface PanelDocument {
  format_version: number;
  kind: "release_history.panel";
  panel_id: string;
  panel_key: Record<string, unknown>;
  country: string;
  engine: {
    policyengine: string;
    bundle_sha256?: string;
    model: { name: string; version: string };
    core: { name: string; version: string };
  };
  producer_version: string;
  point_format_version: number;
  spec_sha256: string;
  definition: Record<string, unknown>;
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

async function readLocalJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
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

/** The series record `release-history series --out <root>` wrote for a country. */
export async function readLocalSeries(root: string, country: string): Promise<SeriesRecord> {
  const series = await readLocalJson<SeriesRecord>(join(root, countryFilePath(country, "series")));
  if (!series) {
    throw new Error(`No series.json for ${country} under ${root}: run \`release-history series --out\`.`);
  }
  return series;
}

/**
 * A point's id, as the Python producer names it (`document.measurement_id`): the sha256 of the
 * canonical JSON of the panel id and the file's sha256.
 */
export function measurementIdFor(panelId: string, digest: string): string {
  return createHash("sha256").update(JSON.stringify({ h5_sha256: digest, panel_id: panelId })).digest("hex");
}

const BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

export async function plan(options: {
  store: ReleaseHistoryStore;
  panel: PanelDocument;
  series: SeriesRecord;
  mode: PlanMode;
  pin: boolean;
  buildId?: string | null;
}): Promise<Plan> {
  const { store, panel } = options;
  if (options.mode === "release" && !BUILD_ID.test(options.buildId ?? "")) {
    throw new Error("Mode release needs --build-id <release>/<build>, as releases.json names it.");
  }
  if (options.mode === "retry" && options.buildId && !BUILD_ID.test(options.buildId)) {
    throw new Error("--build-id names a build as releases.json does: <release>/<build>.");
  }
  const manifest = await readJson<ReleaseHistoryManifest>(store, RELEASE_HISTORY_MANIFEST_PATH);
  // Points already in the store, in case a run's finalize never folded them in.
  const names = new Set(
    (await store.list(panelPrefix(panel.country, panel.panel_id)))
      .filter((path) => storedFileKind(path) === "measurement")
      .map((path) => path.slice(path.lastIndexOf("/") + 1, -".json".length)),
  );
  const stored = new Set(
    listedBuilds(options.series)
      .map((build) => build.digest as string)
      .filter((digest) => names.has(measurementIdFor(panel.panel_id, digest))),
  );
  return planPanel({
    country: panel.country,
    panelId: panel.panel_id,
    mode: options.mode,
    pin: options.pin,
    buildId: options.buildId,
    series: options.series,
    entry: manifest?.countries[panel.country],
    stored,
  });
}

const COUNTRY_FILE_KINDS = new Set(["series", "references", "labels"]);

/**
 * Upload a local store folder: points immutable, panel.json once, the rest replaced. The
 * country's files go up only from a run that pins (`countryFiles`). Attempt reports go first,
 * and one file that fails to upload does not stop the others: the error comes at the end.
 */
export async function uploadDirectory(
  store: ReleaseHistoryStore,
  root: string,
  options: { countryFiles: boolean },
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const failed: string[] = [];
  const files = (await walk(join(root, RELEASE_HISTORY_PREFIX)))
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ file, path: relative(root, file).split("\\").join("/") }))
    .map((entry) => ({ ...entry, kind: storedFileKind(entry.path) }))
    .sort((left, right) =>
      Number(right.kind === "attempt") - Number(left.kind === "attempt") || (left.path < right.path ? -1 : 1)
    );
  for (const { file, path, kind } of files) {
    if (!kind) continue;
    if (COUNTRY_FILE_KINDS.has(kind) && !options.countryFiles) {
      counts[`${kind}:held_back`] = (counts[`${kind}:held_back`] ?? 0) + 1;
      continue;
    }
    try {
      const body = encodeDocument(JSON.parse(await readFile(file, "utf8")));
      let outcome: string;
      if (kind === "measurement") outcome = await putImmutable(store, path, body);
      else if (kind === "panel") outcome = await putWriteOnce(store, path, body);
      else {
        await putReplace(store, path, body);
        outcome = "replaced";
      }
      counts[`${kind}:${outcome}`] = (counts[`${kind}:${outcome}`] ?? 0) + 1;
    } catch (error) {
      failed.push(`${path} (${error instanceof Error ? error.constructor.name : "error"})`);
    }
  }
  if (failed.length > 0) throw new Error(`Upload failed for ${failed.join(", ")}.`);
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

function panelSummary(panel: PanelDocument) {
  return {
    panelId: panel.panel_id,
    engine: {
      policyengine: panel.engine.policyengine,
      model: `${panel.engine.model.name}==${panel.engine.model.version}`,
      core: `${panel.engine.core.name}==${panel.engine.core.version}`,
    },
    specSha256: panel.spec_sha256,
    producerVersion: panel.producer_version,
  };
}

/**
 * Fold a run into the manifest, then rebuild timelines on the country's stored series record: a
 * run that pins rebuilds every panel's, any other run its own panel's only. A series that lists
 * no file leaves the timelines as they were.
 */
export async function finalize(options: {
  store: ReleaseHistoryStore;
  panel: PanelDocument;
  plan: Plan;
  /** A run of the default branch's engine: it may move the pinned and served panels. */
  pin: boolean;
  /** The measure job's result: `cancelled` charges no attempt to a file without a report. */
  measureResult?: string;
  at?: string;
}) {
  const { store, panel } = options;
  const country = panel.country;
  const at = options.at ?? now();
  const series = await readJson<SeriesRecord>(store, countryFilePath(country, "series"));
  const stored = await storedMeasurements(store, country, panel.panel_id);
  const reports: Record<string, AttemptReport> = {};
  for (const point of options.plan.points) {
    const report = await readJson<AttemptReport>(store, attemptPath(country, panel.panel_id, point.digest));
    if (report) reports[point.digest] = report;
  }
  const manifest = await updateManifestCountry(store, country, (entry) =>
    finalizeCountry({
      entry,
      panel: panelSummary(panel),
      series,
      mode: options.plan.mode,
      planned: options.plan.points,
      stored,
      reports,
      cancelled: options.measureResult === "cancelled",
      pin: options.pin,
      at,
    }), at);
  const entry = manifest.countries[country]!;
  let timelines = 0;
  if (series && listedBuilds(series).length > 0) {
    const references = await readJson<ReferencesLock>(store, countryFilePath(country, "references"));
    const labels = await readJson<LabelsDocument>(store, countryFilePath(country, "labels"));
    const rebuilt = options.pin ? Object.keys(entry.panels).sort() : [panel.panel_id];
    for (const panelId of rebuilt) {
      const points = panelId === panel.panel_id ? stored : await storedMeasurements(store, country, panelId);
      const timeline = buildTimeline({
        country,
        panelId,
        series,
        points,
        states: entry.panels[panelId].points,
        references,
        labels,
        builtAt: at,
      });
      await putReplace(store, `${panelPrefix(country, panelId)}timeline.json`, encodeDocument(timeline));
      timelines += 1;
    }
  }
  const record = entry.panels[panel.panel_id];
  return {
    country,
    panelId: panel.panel_id,
    pinned: entry.pinnedPanelId === panel.panel_id,
    current: entry.currentPanelId === panel.panel_id,
    complete: record.complete,
    coverage: record.coverage,
    timelines,
    points: Object.values(record.points).map((point: ManifestPoint) => ({
      digest: point.digest,
      buildId: point.lastBuildId,
      state: point.state,
      measurementStatus: point.measurementStatus,
      attempts: point.attempts,
      lastError: point.lastError,
      lastStage: point.lastStage,
    })),
  };
}

/** Download a panel (the country's current one by default) and the country's files. */
export async function pull(options: { store: ReleaseHistoryStore; country: string; out: string; panelId?: string }) {
  const manifest = await readJson<ReleaseHistoryManifest>(options.store, RELEASE_HISTORY_MANIFEST_PATH);
  const entry = manifest?.countries[options.country];
  const panelId = options.panelId ?? entry?.currentPanelId ?? entry?.pinnedPanelId;
  if (!panelId) throw new Error(`No release history panel for ${options.country}.`);
  const paths = [
    RELEASE_HISTORY_MANIFEST_PATH,
    countryFilePath(options.country, "series"),
    countryFilePath(options.country, "references"),
    countryFilePath(options.country, "labels"),
    ...await options.store.list(panelPrefix(options.country, panelId)),
  ];
  let files = 0;
  for (const path of paths) {
    const found = await options.store.read(path);
    if (!found) continue;
    const target = join(options.out, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, found.body);
    files += 1;
  }
  return { panelId, files };
}

/** Build timeline.json from a local folder (local runs, or a pulled panel). */
export async function localTimeline(root: string, country: string, panelId: string): Promise<string> {
  const series = await readLocalSeries(root, country);
  const folder = join(root, panelPrefix(country, panelId));
  const points: MeasurementDocument[] = [];
  for (const file of (await walk(folder)).sort()) {
    if (storedFileKind(relative(root, file).split("\\").join("/")) === "measurement") {
      points.push(JSON.parse(await readFile(file, "utf8")));
    }
  }
  const manifest = await readLocalJson<ReleaseHistoryManifest>(join(root, RELEASE_HISTORY_MANIFEST_PATH));
  const timeline = buildTimeline({
    country,
    panelId,
    series,
    points,
    states: manifest?.countries[country]?.panels[panelId]?.points,
    references: await readLocalJson<ReferencesLock>(join(root, countryFilePath(country, "references"))),
    labels: await readLocalJson<LabelsDocument>(join(root, countryFilePath(country, "labels"))),
    builtAt: now(),
  });
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

function planMode(value: string | undefined): PlanMode {
  if (PLAN_MODES.includes(value as PlanMode)) return value as PlanMode;
  throw new Error(`--mode must be one of ${PLAN_MODES.join(", ")}.`);
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
      // modes release and retry: the build as releases.json names it, <release>/<build>.
      "build-id": { type: "string" },
      // finalize: the measure job's result (cancelled charges no attempt to a leg that never ran).
      "measure-result": { type: "string" },
      plan: { type: "string" },
      panel: { type: "string" },
      "plan-out": { type: "string" },
      "panel-id": { type: "string" },
      // plan, upload, finalize: set only for a run of the default branch's engine.
      pin: { type: "boolean", default: false },
    },
  });
  if (command === "plan") {
    const panel = await readLocalPanel(values.root!, values.country!);
    const result = await plan({
      store: blobStore(),
      panel,
      series: await readLocalSeries(values.root!, values.country!),
      mode: planMode(values.mode),
      pin: values.pin === true,
      buildId: values["build-id"] || null,
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
        `${result.action} ${result.points.length} of ${result.seriesFiles} files in the series` +
        (result.reason ? ` (${result.reason})` : "") + ".",
    );
    console.log(JSON.stringify({ ...result, points: result.points.map((p) => p.build_id) }));
  } else if (command === "upload") {
    console.log(JSON.stringify(await uploadDirectory(blobStore(), values.root!, { countryFiles: values.pin === true })));
  } else if (command === "finalize") {
    const store = blobStore();
    const panel = values.root
      ? await readLocalPanel(values.root, values.country!)
      : await readStoredPanel(store, values.country!, values["panel-id"]!);
    const planned = JSON.parse(await readFile(values.plan!, "utf8")) as Plan;
    const summary = await finalize({
      store, panel, plan: planned, pin: values.pin === true, measureResult: values["measure-result"],
    });
    const rows = summary.points
      .map((p) => `| ${p.buildId ?? ""} | \`${p.digest.slice(0, 12)}\` | ${p.state} | ${p.measurementStatus ?? ""} | ${p.attempts} | ${[p.lastError, p.lastStage].filter(Boolean).join(" at ")} |`)
      .join("\n");
    const { coverage } = summary;
    await stepSummary(
      `### Release history: ${summary.country}\n\nPanel \`${summary.panelId}\`: ` +
        `${summary.complete ? "complete" : "incomplete"}, ${summary.pinned ? "pinned" : "not pinned"}, ` +
        `${summary.current ? "current" : "not current"}. Series: ${coverage.builds} builds, ${coverage.files} files; ` +
        `${coverage.measured} measured, ${coverage.gap} gaps, ${coverage.retrying} retrying, ` +
        `${coverage.failed} failed, ${coverage.missing} never run. ${summary.timelines} timelines rebuilt.\n\n` +
        `| Build | File | State | Measurement | Attempts | Last error |\n|---|---|---|---|---|---|\n${rows}`,
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
