/**
 * Release history store (calibration-diagnostics#224): the private Vercel Blob
 * layout, the manifest, and the pure logic that plans, finalizes and builds
 * each panel's timeline. The Python producer (`release_history/`) writes to a
 * local folder in this layout; scripts/release-history.ts uploads it and keeps
 * the manifest. PR 2's routes read the same paths.
 *
 *   release-history/manifest.json                          mutable, ETag-conditional
 *   release-history/<country>/series.json                  replaced each run
 *   release-history/<country>/references.json              replaced each run
 *   release-history/<country>/labels.json                  replaced each run
 *   release-history/<country>/<panel>/panel.json           written once
 *   release-history/<country>/<panel>/<measurement>.json   immutable
 *   release-history/<country>/<panel>/attempts/<file>.json replaced at each attempt
 *   release-history/<country>/<panel>/timeline.json        rebuilt by finalize
 *
 * A point is one data file measured on one panel, named by a hash of the
 * panel id and the file's sha256. The series record (the Python `series`
 * command) lists the country's builds from its release repository's
 * releases.json and maps each build to its file; the manifest keys each
 * panel's points by file. Only results and refusals a file itself causes are
 * points; a failure a run causes is a state in the manifest, read from the
 * file's attempt report. Countries never touch each other's manifest entries,
 * so one country's new panel never moves another's.
 */
import { BlobPreconditionFailedError, get, list, put } from "@vercel/blob";

export const RELEASE_HISTORY_PREFIX = "release-history";
export const RELEASE_HISTORY_MANIFEST_PATH = `${RELEASE_HISTORY_PREFIX}/manifest.json`;
// Each document kind has its own format version; an added field never moves one.
export const MANIFEST_FORMAT_VERSION = 1 as const;
export const TIMELINE_FORMAT_VERSION = 1 as const;
export const MAX_ATTEMPTS = 3;
// A run measures at most this many files (a matrix holds 256 jobs); the rest wait for the next.
export const MAX_PLANNED_POINTS = 200;
const IMMUTABLE_CACHE_SECONDS = 31_536_000;
const MUTABLE_CACHE_SECONDS = 60;
const MEASUREMENT_FILE = /^[0-9a-f]{64}\.json$/;

// ---------------------------------------------------------------------------
// Storage

export class WriteConflict extends Error {}

export type WriteMode = "create" | "replace" | { ifMatch: string };

export interface StoredObject {
  body: Uint8Array;
  etag: string;
}

/** The four operations the release history needs from a blob store. */
export interface ReleaseHistoryStore {
  read(path: string): Promise<StoredObject | null>;
  /** Throws WriteConflict when `create` finds an object or `ifMatch` is stale. */
  write(path: string, body: Uint8Array, mode: WriteMode, immutable: boolean): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

async function streamBytes(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!stream) throw new Error("Blob response did not include a body.");
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The private Vercel Blob store, with a token or the deployment's OIDC access. */
export function vercelBlobStore(token?: string): ReleaseHistoryStore {
  const auth = token ? { token } : {};
  return {
    async read(path) {
      const result = await get(path, { access: "private", useCache: false, ...auth });
      if (!result) return null;
      if (result.statusCode !== 200) throw new Error(`Unexpected status ${result.statusCode} for ${path}.`);
      return { body: await streamBytes(result.stream), etag: result.blob.etag };
    },
    async write(path, body, mode, immutable) {
      const conditional = typeof mode === "object";
      try {
        await put(path, Buffer.from(body), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: mode !== "create",
          ...(conditional ? { ifMatch: mode.ifMatch } : {}),
          contentType: "application/json; charset=utf-8",
          cacheControlMaxAge: immutable ? IMMUTABLE_CACHE_SECONDS : MUTABLE_CACHE_SECONDS,
          ...auth,
        });
      } catch (error) {
        if (
          error instanceof BlobPreconditionFailedError ||
          (error instanceof Error && /already exists|precondition failed/i.test(error.message))
        ) {
          throw new WriteConflict(`Write to ${path} conflicted.`);
        }
        throw error;
      }
    },
    async list(prefix) {
      const paths: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, ...auth });
        paths.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return paths;
    },
  };
}

/** An in-memory store with the same semantics, for tests and local runs. */
export function memoryStore(): ReleaseHistoryStore & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  let version = 0;
  return {
    objects,
    async read(path) {
      const found = objects.get(path);
      return found ? { body: found.body.slice(), etag: found.etag } : null;
    },
    async write(path, body, mode) {
      const existing = objects.get(path);
      if (mode === "create" && existing) throw new WriteConflict(`${path} exists.`);
      if (typeof mode === "object" && existing?.etag !== mode.ifMatch) {
        throw new WriteConflict(`${path} changed.`);
      }
      version += 1;
      objects.set(path, { body: body.slice(), etag: `"v${version}"` });
    },
    async list(prefix) {
      return [...objects.keys()].filter((path) => path.startsWith(prefix)).sort();
    },
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeDocument(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export async function readJson<T>(store: ReleaseHistoryStore, path: string): Promise<T | null> {
  const found = await store.read(path);
  return found ? (JSON.parse(decoder.decode(found.body)) as T) : null;
}

/** Write an immutable document; refuse different bytes at the same path. */
export async function putImmutable(
  store: ReleaseHistoryStore,
  path: string,
  body: Uint8Array,
): Promise<"created" | "unchanged"> {
  const existing = await store.read(path);
  if (existing) {
    if (!bytesEqual(existing.body, body)) {
      throw new Error(`Immutable ${path} already exists with different content.`);
    }
    return "unchanged";
  }
  try {
    await store.write(path, body, "create", true);
  } catch (error) {
    if (!(error instanceof WriteConflict)) throw error;
  }
  const written = await store.read(path);
  if (!written || !bytesEqual(written.body, body)) {
    throw new Error(`Immutable ${path} failed verification after upload.`);
  }
  return existing ? "unchanged" : "created";
}

/** Write a document only if none is there (a panel keeps its first panel.json). */
export async function putWriteOnce(
  store: ReleaseHistoryStore,
  path: string,
  body: Uint8Array,
): Promise<"created" | "kept"> {
  if (await store.read(path)) return "kept";
  try {
    await store.write(path, body, "create", true);
    return "created";
  } catch (error) {
    if (error instanceof WriteConflict) return "kept";
    throw error;
  }
}

export async function putReplace(
  store: ReleaseHistoryStore,
  path: string,
  body: Uint8Array,
): Promise<void> {
  await store.write(path, body, "replace", false);
}

// ---------------------------------------------------------------------------
// Paths

const COUNTRY_CODE = /^[a-z][a-z0-9_]*$/;
const PANEL_ID = /^[0-9a-f]{64}$/;

export function countryPrefix(country: string): string {
  return `${RELEASE_HISTORY_PREFIX}/${country}/`;
}

export function panelPrefix(country: string, panelId: string): string {
  return `${countryPrefix(country)}${panelId}/`;
}

/** The country's series record, references and labels: one each, shared by its panels. */
export function countryFilePath(country: string, name: "series" | "references" | "labels"): string {
  return `${countryPrefix(country)}${name}.json`;
}

export type StoredFileKind =
  | "series"
  | "references"
  | "labels"
  | "panel"
  | "timeline"
  | "measurement"
  | "attempt";

const COUNTRY_FILES = new Map<string, StoredFileKind>([
  ["series.json", "series"],
  ["references.json", "references"],
  ["labels.json", "labels"],
]);
const PANEL_FILES = new Map<string, StoredFileKind>([
  ["panel.json", "panel"],
  ["timeline.json", "timeline"],
]);

/** How a stored file is written, by where it sits under `release-history/<country>/`. */
export function storedFileKind(path: string): StoredFileKind | null {
  const parts = path.split("/");
  if (parts[0] !== RELEASE_HISTORY_PREFIX || !COUNTRY_CODE.test(parts[1] ?? "")) return null;
  if (parts.length === 3) return COUNTRY_FILES.get(parts[2]) ?? null;
  if (parts.length === 4 && PANEL_ID.test(parts[2])) {
    return PANEL_FILES.get(parts[3]) ?? (MEASUREMENT_FILE.test(parts[3]) ? "measurement" : null);
  }
  if (parts.length === 5 && PANEL_ID.test(parts[2]) && parts[3] === "attempts") {
    return MEASUREMENT_FILE.test(parts[4]) ? "attempt" : null;
  }
  return null;
}

/** Where a file's attempt report sits on a panel. */
export function attemptPath(country: string, panelId: string, digest: string): string {
  return `${panelPrefix(country, panelId)}attempts/${digest}.json`;
}

function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The series record (written by the Python `series` command, snake_case)

export interface SeriesBuild {
  /** `<release>/<build>`, as releases.json names it. */
  build_id: string;
  release: string;
  build: string;
  release_directory: string;
  published_at: string;
  withdrawn: boolean;
  /** The line's current build. */
  current: boolean;
  in_default_release: boolean;
  role: string | null;
  /** The sha256 of the build's national data file: a point is one file on one panel. */
  digest: string | null;
  dataset_path: string | null;
  release_manifest_sha256: string | null;
  /** `refused` when the build has no file to measure; it is never planned. */
  listing_status: "ok" | "refused";
  listing_reason: string | null;
}

export interface SeriesRecord {
  format_version: number;
  kind: "release_history.series";
  country: string;
  release_repo: string;
  rule: { releases: string[]; since: string | null };
  revision: string;
  /** The one commit of the release repository everything was read at. */
  commit: string;
  listed_at: string;
  record: { present: boolean; sha256: string | null; default: string | null };
  lines: Array<{ release: string; present: boolean; role: string | null }>;
  builds: SeriesBuild[];
}

function publishedTime(build: SeriesBuild): number {
  const time = Date.parse(build.published_at);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/** The series builds that have a file to measure, oldest first, withdrawn ones included. */
export function listedBuilds(series: SeriesRecord | null): SeriesBuild[] {
  if (!series?.record.present) return [];
  return series.builds
    .filter((build) => build.listing_status === "ok" && build.digest !== null)
    .sort((left, right) =>
      publishedTime(left) - publishedTime(right) || compareText(left.build_id, right.build_id)
    );
}

/**
 * The axis every panel of the country shares: listed builds with a file that are not withdrawn,
 * oldest first. Plans, coverage and the timeline's steps follow it.
 */
export function seriesAxis(series: SeriesRecord | null): SeriesBuild[] {
  return listedBuilds(series).filter((build) => !build.withdrawn);
}

// ---------------------------------------------------------------------------
// Manifest

/**
 * A file's state on one panel. `measured`: a stored result (ok, or partial after the last
 * attempt). `gap`: a stored refusal the file itself causes. `retrying`: a run failed and a later
 * run tries again. `failed`: the attempts ran out. Never run: no entry.
 */
export type PointState = "measured" | "gap" | "retrying" | "failed";

export interface ManifestPoint {
  digest: string;
  state: PointState;
  measurementId: string | null;
  measurementStatus: string | null;
  attempts: number;
  lastError: string | null;
  /** Where the last failed attempt stopped (open, download, baseline, reform:<id>, ...). */
  lastStage: string | null;
  /** The build the file was last planned under, when a plan named it. */
  lastBuildId: string | null;
}

/** A panel's points against the series as last listed, counted by file. */
export interface PanelCoverage {
  builds: number;
  files: number;
  measured: number;
  gap: number;
  retrying: number;
  failed: number;
  missing: number;
}

export interface ManifestPanel {
  panelId: string;
  createdAt: string | null;
  /** When the panel last became the pinned one; null for a panel never pinned. */
  pinnedAt: string | null;
  engine: Record<string, unknown>;
  specSha256: string | null;
  producerVersion: string | null;
  complete: boolean;
  coverage: PanelCoverage;
  /** Keyed by the file's sha256. */
  points: Record<string, ManifestPoint>;
}

export interface ManifestCountry {
  pinnedPanelId: string | null;
  currentPanelId: string | null;
  panels: Record<string, ManifestPanel>;
}

export interface ReleaseHistoryManifest {
  formatVersion: typeof MANIFEST_FORMAT_VERSION;
  updatedAt: string | null;
  countries: Record<string, ManifestCountry>;
}

export function emptyManifest(): ReleaseHistoryManifest {
  return { formatVersion: MANIFEST_FORMAT_VERSION, updatedAt: null, countries: {} };
}

export function parseManifest(value: unknown): ReleaseHistoryManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The release history manifest must be an object.");
  }
  const manifest = value as Partial<ReleaseHistoryManifest>;
  if (manifest.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new Error(`Unsupported release history manifest format ${String(manifest.formatVersion)}.`);
  }
  if (!manifest.countries || typeof manifest.countries !== "object") {
    throw new Error("The release history manifest has no countries.");
  }
  return manifest as ReleaseHistoryManifest;
}

/**
 * Re-read, re-apply and write the manifest conditionally until no other writer
 * got there first. `mutate` must be pure: it may run more than once. Never an
 * unconditional write.
 */
export async function updateManifestCountry(
  store: ReleaseHistoryStore,
  country: string,
  mutate: (entry: ManifestCountry | undefined) => ManifestCountry,
  now: string,
  attempts = 5,
): Promise<ReleaseHistoryManifest> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await store.read(RELEASE_HISTORY_MANIFEST_PATH);
    const manifest = current
      ? parseManifest(JSON.parse(decoder.decode(current.body)))
      : emptyManifest();
    const updated: ReleaseHistoryManifest = {
      ...manifest,
      updatedAt: now,
      countries: { ...manifest.countries, [country]: mutate(own(manifest.countries, country)) },
    };
    try {
      await store.write(
        RELEASE_HISTORY_MANIFEST_PATH,
        encodeDocument(updated),
        current ? { ifMatch: current.etag } : "create",
        false,
      );
      return updated;
    } catch (error) {
      if (!(error instanceof WriteConflict)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw new Error("The release history manifest kept changing under this write.");
}

// ---------------------------------------------------------------------------
// Planning

/** The point JSON the Python producer reads (`releases.Point.from_json`). */
export interface PlannedPoint {
  build_id: string;
  release_directory: string;
  hf_repo: string;
  hf_commit: string;
  /** The file the series listed; the producer refuses a different one. */
  digest: string;
  attempt: number;
  /** A partial result (a reform failed) is stored only on the last attempt. */
  last_attempt: boolean;
}

export type PlanMode = "topup" | "backfill" | "release" | "retry";
export const PLAN_MODES: readonly PlanMode[] = ["topup", "backfill", "release", "retry"];

export interface Plan {
  country: string;
  panelId: string;
  mode: PlanMode;
  /** Whether the run is one of the default branch's engine, which may move the pinned panel. */
  pin: boolean;
  action: "measure" | "skip";
  reason: string | null;
  /** The release repository commit the series was listed at. */
  seriesCommit: string | null;
  /** Distinct files on the series axis. */
  seriesFiles: number;
  points: PlannedPoint[];
}

/** A state no plan changes: measured, a stored gap, or out of attempts. */
function isFinal(point: ManifestPoint | undefined): boolean {
  return point?.state === "measured" || point?.state === "gap" || point?.state === "failed";
}

function plannedPoint(
  series: SeriesRecord,
  build: SeriesBuild,
  state: ManifestPoint | undefined,
  maxAttempts: number,
): PlannedPoint {
  const attempt = (state?.state === "retrying" ? state.attempts : 0) + 1;
  return {
    build_id: build.build_id,
    release_directory: build.release_directory,
    hf_repo: series.release_repo,
    hf_commit: series.commit,
    digest: build.digest as string,
    attempt,
    last_attempt: attempt >= maxAttempts,
  };
}

/** One build per file, the earliest published: one file under two build names is one point. */
function oneBuildPerFile(builds: SeriesBuild[]): SeriesBuild[] {
  const seen = new Set<string>();
  return builds.filter((build) => {
    const digest = build.digest as string;
    if (seen.has(digest)) return false;
    seen.add(digest);
    return true;
  });
}

/**
 * Which files a run measures on a panel.
 *
 * - `backfill`: every file on the axis the panel does not hold yet.
 * - `topup` (runs that pin only): the files no panel that was ever pinned holds, and, when another
 *   panel was pinned before, the latest build that panel measured, so the first new build has a
 *   step. A country's first panel waits for its backfill.
 * - `release`: one build, by its `<release>/<build>` id.
 * - `retry`: the files that ran out of attempts (or one build's), with fresh attempts.
 *
 * `stored` names the files whose point is already in the store, as a fallback for a run whose
 * finalize never folded them into the manifest. A run plans at most MAX_PLANNED_POINTS files.
 */
export function planPanel(options: {
  country: string;
  panelId: string;
  mode: PlanMode;
  pin: boolean;
  buildId?: string | null;
  series: SeriesRecord | null;
  entry: ManifestCountry | undefined;
  stored?: ReadonlySet<string>;
  maxAttempts?: number;
}): Plan {
  const { country, panelId, mode, pin, series, entry } = options;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const axis = seriesAxis(series);
  const files = new Set(axis.map((build) => build.digest as string)).size;
  const base = { country, panelId, mode, pin, seriesCommit: series?.commit ?? null, seriesFiles: files };
  const skip = (reason: string): Plan => ({ ...base, action: "skip", reason, points: [] });
  if (!series?.record.present) return skip("no_releases_record");
  if (axis.length === 0) return skip("empty_series");
  const panel = own(entry?.panels, panelId);
  const stateOf = (build: SeriesBuild) => own(panel?.points, build.digest as string);
  const heldHere = (build: SeriesBuild) =>
    isFinal(stateOf(build)) || (options.stored?.has(build.digest as string) ?? false);
  const measure = (builds: SeriesBuild[]): Plan => {
    const points = oneBuildPerFile(builds).map((build) =>
      plannedPoint(series, build, stateOf(build), maxAttempts)
    );
    if (points.length === 0) return skip("nothing_missing");
    const truncated = points.length > MAX_PLANNED_POINTS;
    return {
      ...base,
      action: "measure",
      reason: truncated ? "truncated" : null,
      points: points.slice(0, MAX_PLANNED_POINTS),
    };
  };

  const named = () => {
    const build = series.builds.find((candidate) => candidate.build_id === options.buildId);
    if (!build) return "release_not_in_series";
    if (build.withdrawn) return "release_withdrawn";
    if (build.listing_status !== "ok" || build.digest === null) {
      return build.listing_reason ?? "release_not_measurable";
    }
    return build;
  };
  if (mode === "release") {
    const build = named();
    if (typeof build === "string") return skip(build);
    if (stateOf(build)?.state === "failed") return skip("release_failed");
    if (heldHere(build)) return skip("already_measured");
    return measure([build]);
  }
  if (mode === "retry") {
    // A failed file starts again at attempt 1 (plannedPoint counts on from retrying files only).
    if (options.buildId) {
      const build = named();
      if (typeof build === "string") return skip(build);
      return stateOf(build)?.state === "failed" ? measure([build]) : skip("release_not_failed");
    }
    const failed = axis.filter((build) => stateOf(build)?.state === "failed");
    return failed.length > 0 ? measure(failed) : skip("nothing_failed");
  }
  if (mode === "backfill") return measure(axis.filter((build) => !heldHere(build)));
  // A top-up follows the pinned engine: a run from another ref fills its panel with a backfill or
  // single releases instead.
  if (!pin) return skip("topup_only_on_the_default_branch");
  const everPinned = Object.values(entry?.panels ?? {}).filter((candidate) => candidate.pinnedAt !== null);
  if (everPinned.length === 0) return skip("first_panel_awaits_backfill");
  const heldAnywhere = (build: SeriesBuild) =>
    heldHere(build) ||
    everPinned.some((candidate) => isFinal(own(candidate.points, build.digest as string)));
  const fresh = axis.filter((build) => !heldAnywhere(build));
  // The panel pinned before this one: the pinned panel, or, when this is it, the one before.
  const previous = everPinned
    .filter((candidate) => candidate.panelId !== panelId)
    .sort((left, right) => compareText(right.pinnedAt as string, left.pinnedAt as string))[0];
  const overlap = previous
    ? [...axis].reverse().find(
      (build) => own(previous.points, build.digest as string)?.state === "measured",
    )
    : undefined;
  const chosen = new Set([...fresh, ...(overlap && !heldHere(overlap) ? [overlap] : [])]);
  return measure(axis.filter((build) => chosen.has(build)));
}

// ---------------------------------------------------------------------------
// Finalizing

export interface PanelSummary {
  panelId: string;
  engine: Record<string, unknown>;
  specSha256: string | null;
  producerVersion: string | null;
}

export interface MeasurementCell {
  output: string;
  period: number;
  unit: string;
  value: number | null;
  status: string;
  reason?: string | null;
}

/** A file's attempt report, as the Python producer writes it (`cli.AttemptReport`). */
export interface AttemptReport {
  format_version: number;
  kind: "release_history.attempt";
  country: string;
  panel_id: string;
  digest: string;
  build_id: string;
  attempt: number;
  last_attempt: boolean;
  /** `interrupted`: written before a stage and never replaced, so the run died there. */
  status: "interrupted" | "failed";
  stage: string;
  reason: string;
  error_class: string | null;
  at: string;
}

/** A failure no later attempt can fix: the file is over the runner's budget. */
export const FAILS_AT_ONCE: ReadonlySet<string> = new Set(["exceeds_runner_budget"]);

/** A stored point, as the Python producer writes it (snake_case; `document.py`). */
export interface MeasurementDocument {
  format_version: number;
  kind: string;
  country: string;
  panel_id: string;
  measurement_id: string;
  /** ok, partial (a reform failed on the last attempt), or refused (the file's own fault). */
  status: string;
  reason: string | null;
  /** The file alone; what the build it was fetched through declares is under `fetched_from`. */
  file: { sha256: string; bytes: number | null };
  cells: MeasurementCell[];
}

function emptyCoverage(): PanelCoverage {
  return { builds: 0, files: 0, measured: 0, gap: 0, retrying: 0, failed: 0, missing: 0 };
}

/** A panel's coverage of the axis, by file; complete when no file is retrying or never run. */
export function panelCoverage(
  points: Record<string, ManifestPoint>,
  axis: SeriesBuild[],
): { coverage: PanelCoverage; complete: boolean } {
  const files = [...new Set(axis.map((build) => build.digest as string))];
  const coverage = { ...emptyCoverage(), builds: axis.length, files: files.length };
  for (const digest of files) coverage[own(points, digest)?.state ?? "missing"] += 1;
  return { coverage, complete: files.length > 0 && coverage.retrying === 0 && coverage.missing === 0 };
}

/**
 * The country's manifest entry after a run: the run's panel gets its points and attempts, and
 * every panel's coverage is recomputed against the series as listed now.
 *
 * Every panel a run touches is kept, with its engine, so a page can offer each engine's
 * timeline. Only a pinning run (`pin`: one of the default branch's engine) moves the pinned
 * panel, and the served (current) panel once that panel is complete. A run dispatched from a
 * ref that pins another engine fills that engine's panel and leaves both where they are.
 */
export function finalizeCountry(options: {
  entry: ManifestCountry | undefined;
  panel: PanelSummary;
  series: SeriesRecord | null;
  /** The run's plan mode: a country's first panel is pinned only by its backfill. */
  mode: PlanMode;
  planned: PlannedPoint[];
  stored: MeasurementDocument[];
  /** The planned files' attempt reports in the store, by file sha256. */
  reports?: Record<string, AttemptReport>;
  /** The run was cancelled: a planned file with no point and no report of its attempt never ran. */
  cancelled?: boolean;
  pin: boolean;
  at: string;
  maxAttempts?: number;
}): ManifestCountry {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const { panelId } = options.panel;
  const entry: ManifestCountry = options.entry
    ? { ...options.entry, panels: { ...options.entry.panels } }
    : { pinnedPanelId: null, currentPanelId: null, panels: {} };
  const previous = own(entry.panels, panelId);
  const points: Record<string, ManifestPoint> = { ...(previous?.points ?? {}) };
  const stored = new Map(options.stored.map((document) => [document.file.sha256, document]));
  const planned = new Map(options.planned.map((point) => [point.digest, point]));
  // The attempt counts are the plan's, so finalizing one run twice (a re-run of failed jobs)
  // charges each file once; a report from another attempt says nothing about this one.
  for (const point of options.planned) {
    if (stored.has(point.digest)) continue;
    const found = own(options.reports, point.digest);
    const report = found?.attempt === point.attempt ? found : undefined;
    if (!report && options.cancelled) continue;
    const reason = report ? report.reason : "no_measurement_written";
    const failed = point.last_attempt || point.attempt >= maxAttempts || FAILS_AT_ONCE.has(reason);
    points[point.digest] = {
      digest: point.digest,
      state: failed ? "failed" : "retrying",
      measurementId: null,
      measurementStatus: null,
      attempts: point.attempt,
      lastError: reason,
      lastStage: report?.stage ?? null,
      lastBuildId: point.build_id,
    };
  }
  for (const [digest, document] of stored) {
    const point = planned.get(digest);
    const before = own(points, digest);
    const refused = document.status === "refused";
    points[digest] = {
      digest,
      state: refused ? "gap" : "measured",
      measurementId: document.measurement_id,
      measurementStatus: document.status,
      attempts: point?.attempt ?? Math.max(before?.attempts ?? 0, 1),
      lastError: refused ? document.reason : null,
      lastStage: null,
      lastBuildId: point?.build_id ?? before?.lastBuildId ?? null,
    };
  }
  // A pinning run with nothing planned and nothing held pins nothing, and a country's first
  // panel is pinned only by its backfill: a single release or a top-up never starts a series.
  const pinnedBefore = Object.values(entry.panels).some((candidate) => candidate.pinnedAt !== null);
  const pinning = options.pin &&
    (options.planned.length > 0 || Object.keys(points).length > 0) &&
    (pinnedBefore || options.mode === "backfill");
  let pinnedAt = previous?.pinnedAt ?? null;
  if (pinning && (entry.pinnedPanelId !== panelId || pinnedAt === null)) pinnedAt = options.at;
  entry.panels[panelId] = {
    panelId,
    createdAt: previous?.createdAt ?? options.at,
    pinnedAt,
    engine: options.panel.engine,
    specSha256: options.panel.specSha256,
    producerVersion: options.panel.producerVersion,
    complete: previous?.complete ?? false,
    coverage: previous?.coverage ?? emptyCoverage(),
    points,
  };
  // A series that lists nothing (no record, or no build on the axis) leaves coverage as it was:
  // a missing record says nothing about the panels.
  const axis = seriesAxis(options.series);
  if (axis.length > 0) {
    for (const [id, panel] of Object.entries(entry.panels)) {
      entry.panels[id] = { ...panel, ...panelCoverage(panel.points, axis) };
    }
  }
  if (pinning) {
    entry.pinnedPanelId = panelId;
    if (entry.panels[panelId].complete) entry.currentPanelId = panelId;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Timeline

export interface ReferenceEntry {
  status: "resolved" | "citation" | "none";
  value?: number;
  sign?: number;
  basis?: string | null;
  output?: string | null;
  note?: string | null;
  reason?: string;
  citation?: Record<string, unknown>;
  registry?: Record<string, unknown> | null;
  facts?: Array<{ source_record_id?: string; semantic_fact_key?: string; period?: unknown }>;
}

/** The country's references.json (the Python `references.lock.json`). */
export interface ReferencesLock {
  baseline: Record<string, ReferenceEntry>;
  reforms: Record<string, ReferenceEntry>;
  chronicle?: Record<string, unknown>;
}

/** The country's labels.json: what the page shows for each reform. Replaceable, not hashed. */
export interface LabelsDocument {
  format_version: number;
  kind: "release_history.labels";
  country: string;
  reforms: Record<string, { label: string | null; source: Record<string, unknown> | null }>;
}

export interface TimelineBuild {
  buildId: string;
  release: string;
  build: string;
  publishedAt: string;
  /** The current build of the record's default release. */
  current: boolean;
  /** Withdrawn builds are listed but never a neighbour: no step starts or ends at one. */
  withdrawn: boolean;
  digest: string;
  /** The earliest earlier build that publishes the same file. */
  sameFileAs: string | null;
  /** The file's state on this panel; `missing` when it was never run. */
  state: PointState | "missing";
  measurementId: string | null;
  /** The stored point's status: ok, partial or refused. */
  status: string | null;
  /** A gap's refusal reason, or the last error of a failed or retrying file. */
  reason: string | null;
}

export interface TimelineValue {
  buildId: string;
  value: number | null;
  /** ok or withheld (the cell's own), missing (the point has no such cell), or unmeasured. */
  status: string;
  /** The neighbour the change is from: the previous build on the axis, when both have the cell. */
  comparedWith: string | null;
  change: number | null;
  /** change / |previous|, for currency and counts. */
  relativeChange: number | null;
  /** The change in percentage points, for rates (shares) and percentages. */
  changePoints: number | null;
  changeStatus: "ok" | "withheld" | "none";
}

export interface TimelineOutput {
  output: string;
  period: number;
  unit: string;
  reference: (ReferenceEntry & { modelSignValue?: number }) | null;
  /** One value per build, in the order of `builds`. */
  values: TimelineValue[];
}

export interface Timeline {
  formatVersion: typeof TIMELINE_FORMAT_VERSION;
  kind: "release_history.timeline";
  country: string;
  panelId: string;
  builtAt: string;
  listing: { commit: string; listedAt: string; rule: { releases: string[]; since: string | null } };
  labels: LabelsDocument["reforms"];
  builds: TimelineBuild[];
  outputs: TimelineOutput[];
  chronicle: Record<string, unknown> | null;
}

function referenceFor(output: string, references: ReferencesLock | null): ReferenceEntry | null {
  if (!references) return null;
  const parts = output.split("/");
  if (parts[0] === "baseline" && parts.length === 2) return own(references.baseline, parts[1]) ?? null;
  if (parts[0] === "reform" && parts.length >= 3) {
    const entry = own(references.reforms, parts[1]);
    const target = entry?.output ?? "budgetary_impact";
    return entry && parts.slice(2).join("/") === target ? entry : null;
  }
  return null;
}

function referencePeriodMatches(entry: ReferenceEntry, period: number): boolean {
  const periods = (entry.facts ?? [])
    .map((fact) => (fact.period as { value?: unknown } | undefined)?.value)
    .filter((value): value is number => typeof value === "number");
  return periods.length === 0 || periods.every((value) => value === period);
}

function stateOfStored(document: MeasurementDocument): PointState {
  return document.status === "refused" ? "gap" : "measured";
}

/**
 * A panel's numbers on the country's series axis. Order, publish times, `current` and withdrawn
 * come from the series record, joined to the points by file digest, so a corrected publish time
 * re-orders the timeline with no re-run. A point whose file the series no longer lists never
 * plots. A step exists only between neighbours on the axis that both hold the cell; a withheld
 * cell carries its status and no reason (the point keeps the reason).
 */
export function buildTimeline(options: {
  country: string;
  panelId: string;
  series: SeriesRecord;
  points: MeasurementDocument[];
  /** The panel's manifest points, for retrying and failed files; stored points suffice without. */
  states?: Record<string, ManifestPoint>;
  references: ReferencesLock | null;
  labels: LabelsDocument | null;
  builtAt: string;
}): Timeline {
  const listed = listedBuilds(options.series);
  const byDigest = new Map(options.points.map((point) => [point.file.sha256, point]));
  const firstWithFile = new Map<string, string>();
  const builds: TimelineBuild[] = listed.map((build) => {
    const digest = build.digest as string;
    const point = byDigest.get(digest);
    const state = own(options.states, digest);
    const sameFileAs = firstWithFile.get(digest) ?? null;
    if (!sameFileAs) firstWithFile.set(digest, build.build_id);
    return {
      buildId: build.build_id,
      release: build.release,
      build: build.build,
      publishedAt: build.published_at,
      current: build.current && build.in_default_release,
      withdrawn: build.withdrawn,
      digest,
      sameFileAs,
      state: point ? stateOfStored(point) : state?.state ?? "missing",
      measurementId: point?.measurement_id ?? null,
      status: point?.status ?? null,
      reason: point ? point.reason : state?.lastError ?? null,
    };
  });
  const pointOf = listed.map((build) => byDigest.get(build.digest as string));
  const keys = new Map<string, { output: string; period: number; unit: string }>();
  for (const point of pointOf) {
    for (const cell of point?.cells ?? []) {
      const key = `${cell.output}@${cell.period}`;
      if (!keys.has(key)) keys.set(key, { output: cell.output, period: cell.period, unit: cell.unit });
    }
  }
  const cellsOf = pointOf.map((point) =>
    new Map((point?.cells ?? []).map((cell) => [`${cell.output}@${cell.period}`, cell]))
  );
  const ordered = [...keys.entries()].sort(([, left], [, right]) =>
    compareText(left.output, right.output) || left.period - right.period
  );
  const outputs: TimelineOutput[] = ordered.map(([key, { output, period, unit }]) => {
    let previous: { buildId: string; cell: MeasurementCell | undefined } | null = null;
    const values = builds.map((build, index): TimelineValue => {
      const cell = cellsOf[index].get(key);
      const value: TimelineValue = {
        buildId: build.buildId,
        value: cell?.value ?? null,
        status: cell?.status ?? (pointOf[index] && build.state === "measured" ? "missing" : "unmeasured"),
        comparedWith: null,
        change: null,
        relativeChange: null,
        changePoints: null,
        changeStatus: "none",
      };
      if (build.withdrawn) return value;
      const before = previous?.cell;
      if (cell && before && previous) {
        value.comparedWith = previous.buildId;
        if (cell.status === "withheld" || before.status === "withheld") {
          value.changeStatus = "withheld";
        } else if (cell.value !== null && before.value !== null) {
          const change = cell.value - before.value;
          value.change = change;
          value.changeStatus = "ok";
          if (unit === "rate") value.changePoints = change * 100;
          else if (unit === "ratio") value.changePoints = change;
          else if (before.value !== 0) value.relativeChange = change / Math.abs(before.value);
        }
      }
      previous = { buildId: build.buildId, cell };
      return value;
    });
    const entry = referenceFor(output, options.references);
    const reference = entry && referencePeriodMatches(entry, period)
      ? {
          ...entry,
          ...(typeof entry.value === "number"
            ? { modelSignValue: entry.value * (entry.sign ?? 1) }
            : {}),
        }
      : null;
    return { output, period, unit, reference, values };
  });
  return {
    formatVersion: TIMELINE_FORMAT_VERSION,
    kind: "release_history.timeline",
    country: options.country,
    panelId: options.panelId,
    builtAt: options.builtAt,
    listing: {
      commit: options.series.commit,
      listedAt: options.series.listed_at,
      rule: options.series.rule,
    },
    labels: options.labels?.reforms ?? {},
    builds,
    outputs,
    chronicle: options.references?.chronicle ?? null,
  };
}
