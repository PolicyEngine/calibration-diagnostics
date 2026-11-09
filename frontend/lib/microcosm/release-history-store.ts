/**
 * Release history store (calibration-diagnostics#224): the private Vercel Blob
 * layout, the manifest, and the pure logic that plans, finalizes and builds a
 * panel's timeline. The Python producer (`release_history/`) writes points to
 * a local folder in this layout; scripts/release-history.ts uploads them and
 * keeps the manifest. PR 2's routes read the same paths.
 *
 *   release-history/manifest.json                          mutable, ETag-conditional
 *   release-history/<country>/<panel>/panel.json           written once
 *   release-history/<country>/<panel>/<measurement>.json   immutable
 *   release-history/<country>/<panel>/references.json      replaced each run
 *   release-history/<country>/<panel>/timeline.json        rebuilt by finalize
 *
 * Countries never touch each other's manifest entries, so one country's new
 * panel never moves another's.
 */
import { BlobPreconditionFailedError, get, list, put } from "@vercel/blob";

export const RELEASE_HISTORY_PREFIX = "release-history";
export const RELEASE_HISTORY_MANIFEST_PATH = `${RELEASE_HISTORY_PREFIX}/manifest.json`;
export const RELEASE_HISTORY_SCHEMA_VERSION = 1 as const;
export const MAX_ATTEMPTS = 3;
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

export function panelPrefix(country: string, panelId: string): string {
  return `${RELEASE_HISTORY_PREFIX}/${country}/${panelId}/`;
}

export type StoredFileKind = "panel" | "references" | "timeline" | "measurement";

/** How a file in a panel folder is written, by its name. */
export function storedFileKind(path: string): StoredFileKind | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === "panel.json") return "panel";
  if (name === "references.json") return "references";
  if (name === "timeline.json") return "timeline";
  if (MEASUREMENT_FILE.test(name)) return "measurement";
  return null;
}

// ---------------------------------------------------------------------------
// Manifest

export type PointState = "pending" | "measured" | "failed";

export interface ManifestPoint {
  releaseId: string;
  releaseDirectory: string;
  hfRepo: string;
  hfCommitSha: string;
  publishedAt: string | null;
  state: PointState;
  measurementId: string | null;
  measurementStatus: string | null;
  attempts: number;
  lastError: string | null;
  withdrawn: boolean;
}

export interface ManifestPanel {
  panelId: string;
  createdAt: string | null;
  engine: Record<string, unknown>;
  specSha256: string | null;
  producerVersion: string | null;
  complete: boolean;
  points: Record<string, ManifestPoint>;
}

export interface ManifestCountry {
  pinnedPanelId: string | null;
  currentPanelId: string | null;
  panels: Record<string, ManifestPanel>;
}

export interface ReleaseHistoryManifest {
  schemaVersion: typeof RELEASE_HISTORY_SCHEMA_VERSION;
  updatedAt: string | null;
  countries: Record<string, ManifestCountry>;
}

export function emptyManifest(): ReleaseHistoryManifest {
  return { schemaVersion: RELEASE_HISTORY_SCHEMA_VERSION, updatedAt: null, countries: {} };
}

export function parseManifest(value: unknown): ReleaseHistoryManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The release history manifest must be an object.");
  }
  const manifest = value as Partial<ReleaseHistoryManifest>;
  if (manifest.schemaVersion !== RELEASE_HISTORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported release history manifest schema ${String(manifest.schemaVersion)}.`);
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
      countries: { ...manifest.countries, [country]: mutate(manifest.countries[country]) },
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

export interface SeriesSpec {
  releases: string[];
  exclude: string[];
}

/** The Python spec's `matches_series`: a release name, its build folders, or a ^regex. */
export function seriesMatches(series: SeriesSpec, releaseDirectory: string): boolean {
  if (series.exclude.some((pattern) => new RegExp(pattern).test(releaseDirectory))) return false;
  return series.releases.some((name) =>
    name.startsWith("^")
      ? new RegExp(name).test(releaseDirectory)
      : releaseDirectory === name || releaseDirectory.startsWith(`${name}/`)
  );
}

export interface ReleaseBuild {
  releaseId: string;
  releaseDirectory: string;
  hfRepo: string;
  hfCommitSha: string;
  publishedAt: string | null;
  current: boolean;
  withdrawn: boolean;
}

/** The point JSON the Python producer reads (`releases.Point.from_json`). */
export interface PlannedPoint {
  release_id: string;
  release_directory: string;
  hf_repo: string;
  hf_commit: string;
  published_at: string | null;
  current: boolean;
}

export type PlanMode = "topup" | "backfill" | "release";

export interface Plan {
  country: string;
  panelId: string;
  mode: PlanMode;
  action: "measure" | "skip";
  reason: string | null;
  seriesSize: number;
  points: PlannedPoint[];
}

function isFinal(point: ManifestPoint | undefined): boolean {
  return point?.state === "measured" || point?.state === "failed";
}

function planned(build: ReleaseBuild): PlannedPoint {
  return {
    release_id: build.releaseId,
    release_directory: build.releaseDirectory,
    hf_repo: build.hfRepo,
    hf_commit: build.hfCommitSha,
    published_at: build.publishedAt,
    current: build.current,
  };
}

/** Which points a run measures. Backfills of a new panel start only on request. */
export function planPanel(options: {
  country: string;
  panelId: string;
  mode: PlanMode;
  releaseId?: string | null;
  builds: ReleaseBuild[];
  entry: ManifestCountry | undefined;
}): Plan {
  const { country, panelId, mode, entry } = options;
  const series = options.builds.filter((build) => !build.withdrawn);
  const panel = entry?.panels[panelId];
  const missing = series.filter((build) => !isFinal(panel?.points[build.releaseId]));
  const base = { country, panelId, mode, seriesSize: series.length };
  if (mode === "release") {
    const build = series.find((candidate) => candidate.releaseId === options.releaseId);
    if (!build) return { ...base, action: "skip", reason: "release_not_in_series", points: [] };
    if (isFinal(panel?.points[build.releaseId])) {
      return { ...base, action: "skip", reason: "already_measured", points: [] };
    }
    return { ...base, action: "measure", reason: null, points: [planned(build)] };
  }
  if (mode === "topup" && entry?.currentPanelId !== panelId && !panel?.complete) {
    return { ...base, action: "skip", reason: "pinned_panel_awaits_backfill", points: [] };
  }
  if (missing.length === 0) return { ...base, action: "skip", reason: "nothing_missing", points: [] };
  return { ...base, action: "measure", reason: null, points: missing.map(planned) };
}

// ---------------------------------------------------------------------------
// Finalizing

export interface PanelSummary {
  panelId: string;
  createdAt: string | null;
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
  reason?: string;
}

/** A stored point, as the Python producer writes it (snake_case). */
export interface MeasurementDocument {
  measurement_id: string;
  status: string;
  reason?: string;
  point: {
    release_id: string;
    release_directory: string;
    hf_repo: string;
    hf_commit: string;
    published_at: string | null;
  } & Record<string, unknown>;
  cells: MeasurementCell[];
}

/** The country's manifest entry after a run: points, attempts, completeness, current. */
export function finalizeCountry(options: {
  entry: ManifestCountry | undefined;
  panel: PanelSummary;
  builds: ReleaseBuild[];
  planned: PlannedPoint[];
  stored: MeasurementDocument[];
  maxAttempts?: number;
}): ManifestCountry {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const entry: ManifestCountry = options.entry
    ? { ...options.entry, panels: { ...options.entry.panels } }
    : { pinnedPanelId: null, currentPanelId: null, panels: {} };
  const previous = entry.panels[options.panel.panelId];
  const points: Record<string, ManifestPoint> = { ...(previous?.points ?? {}) };
  const withdrawn = new Set(options.builds.filter((b) => b.withdrawn).map((b) => b.releaseId));
  const storedIds = new Set<string>();
  for (const stored of options.stored) {
    const id = stored.point.release_id;
    storedIds.add(id);
    points[id] = {
      releaseId: id,
      releaseDirectory: stored.point.release_directory,
      hfRepo: stored.point.hf_repo,
      hfCommitSha: stored.point.hf_commit,
      publishedAt: stored.point.published_at,
      state: "measured",
      measurementId: stored.measurement_id,
      measurementStatus: stored.status,
      attempts: Math.max(points[id]?.attempts ?? 0, 1),
      lastError: null,
      withdrawn: withdrawn.has(id),
    };
  }
  for (const plannedPoint of options.planned) {
    const id = plannedPoint.release_id;
    if (storedIds.has(id)) continue;
    const attempts = (points[id]?.attempts ?? 0) + 1;
    points[id] = {
      releaseId: id,
      releaseDirectory: plannedPoint.release_directory,
      hfRepo: plannedPoint.hf_repo,
      hfCommitSha: plannedPoint.hf_commit,
      publishedAt: plannedPoint.published_at,
      state: attempts >= maxAttempts ? "failed" : "pending",
      measurementId: null,
      measurementStatus: null,
      attempts,
      lastError: "no_measurement_written",
      withdrawn: withdrawn.has(id),
    };
  }
  for (const id of Object.keys(points)) {
    if (withdrawn.has(id)) points[id] = { ...points[id], withdrawn: true };
  }
  const complete = options.builds
    .filter((build) => !build.withdrawn)
    .every((build) => isFinal(points[build.releaseId]));
  entry.panels[options.panel.panelId] = {
    panelId: options.panel.panelId,
    createdAt: previous?.createdAt ?? options.panel.createdAt,
    engine: options.panel.engine,
    specSha256: options.panel.specSha256,
    producerVersion: options.panel.producerVersion,
    complete,
    points,
  };
  entry.pinnedPanelId = options.panel.panelId;
  if (complete) entry.currentPanelId = options.panel.panelId;
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

export interface ReferencesLock {
  baseline: Record<string, ReferenceEntry>;
  reforms: Record<string, ReferenceEntry>;
  chronicle?: Record<string, unknown>;
}

export interface TimelineValue {
  measurementId: string;
  value: number | null;
  status: string;
  reason?: string;
  /** The measurement this value is compared with: the nearest earlier one that has the cell. */
  comparedWith: string | null;
  change: number | null;
  /** change / |previous|, for currency and counts. */
  relativeChange: number | null;
  /** The change in percentage points, for rates (shares) and percentages. */
  changePoints: number | null;
  changeStatus: "ok" | "withheld" | "none";
}

export interface TimelineSeries {
  output: string;
  period: number;
  unit: string;
  reference: (ReferenceEntry & { modelSignValue?: number }) | null;
  values: TimelineValue[];
}

export interface TimelinePoint {
  measurementId: string;
  releaseId: string;
  releaseDirectory: string;
  publishedAt: string | null;
  status: string;
  reason?: string;
}

export interface Timeline {
  schemaVersion: typeof RELEASE_HISTORY_SCHEMA_VERSION;
  kind: "release_history.timeline";
  country: string;
  panelId: string;
  builtAt: string;
  points: TimelinePoint[];
  series: TimelineSeries[];
  chronicle: Record<string, unknown> | null;
}

function referenceFor(output: string, references: ReferencesLock | null): ReferenceEntry | null {
  if (!references) return null;
  const parts = output.split("/");
  if (parts[0] === "baseline" && parts.length === 2) return references.baseline[parts[1]] ?? null;
  if (parts[0] === "reform" && parts.length >= 3) {
    const entry = references.reforms[parts[1]];
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

/** Every stored number of a panel as series in release order, with release-to-release changes. */
export function buildTimeline(options: {
  country: string;
  panelId: string;
  points: MeasurementDocument[];
  references: ReferencesLock | null;
  builtAt: string;
}): Timeline {
  const ordered = [...options.points].sort((left, right) =>
    (left.point.published_at ?? "").localeCompare(right.point.published_at ?? "") ||
    left.point.release_id.localeCompare(right.point.release_id)
  );
  const keys = new Map<string, { output: string; period: number; unit: string }>();
  for (const point of ordered) {
    for (const cell of point.cells) {
      const key = `${cell.output}@${cell.period}`;
      if (!keys.has(key)) keys.set(key, { output: cell.output, period: cell.period, unit: cell.unit });
    }
  }
  const cellsByPoint = ordered.map((point) =>
    new Map(point.cells.map((cell) => [`${cell.output}@${cell.period}`, cell]))
  );
  const series: TimelineSeries[] = [];
  for (const [key, { output, period, unit }] of [...keys.entries()].sort()) {
    const values: TimelineValue[] = [];
    let previous: { measurementId: string; cell: MeasurementCell } | null = null;
    ordered.forEach((point, index) => {
      const cell = cellsByPoint[index].get(key);
      const value: TimelineValue = {
        measurementId: point.measurement_id,
        value: cell?.value ?? null,
        status: cell?.status ?? (point.status === "ok" ? "missing" : point.status),
        ...(cell?.reason ? { reason: cell.reason } : {}),
        comparedWith: previous?.measurementId ?? null,
        change: null,
        relativeChange: null,
        changePoints: null,
        changeStatus: "none",
      };
      if (cell && previous) {
        if (cell.status === "withheld" || previous.cell.status === "withheld") {
          value.changeStatus = "withheld";
        } else if (cell.value !== null && previous.cell.value !== null) {
          const change = cell.value - previous.cell.value;
          value.change = change;
          value.changeStatus = "ok";
          if (unit === "rate") value.changePoints = change * 100;
          else if (unit === "ratio") value.changePoints = change;
          else if (previous.cell.value !== 0) value.relativeChange = change / Math.abs(previous.cell.value);
        }
      }
      if (cell && (cell.status === "ok" || cell.status === "withheld")) {
        previous = { measurementId: point.measurement_id, cell };
      }
      values.push(value);
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
    series.push({ output, period, unit, reference, values });
  }
  return {
    schemaVersion: RELEASE_HISTORY_SCHEMA_VERSION,
    kind: "release_history.timeline",
    country: options.country,
    panelId: options.panelId,
    builtAt: options.builtAt,
    points: ordered.map((point) => ({
      measurementId: point.measurement_id,
      releaseId: point.point.release_id,
      releaseDirectory: point.point.release_directory,
      publishedAt: point.point.published_at,
      status: point.status,
      ...(point.reason ? { reason: point.reason } : {}),
    })),
    series,
    chronicle: options.references?.chronicle ?? null,
  };
}
