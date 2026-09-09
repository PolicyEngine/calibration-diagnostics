import {
  type Calibration,
  type MicrocosmCountry,
  asObject,
  assertSafeReleaseId,
  buildCalibration,
  buildComparison,
  latestMicrocosmCalibrationSummary,
  latestMicrocosmTargetDiagnosticsPage,
  loadRelease,
  microcosmCountryGeography,
} from "@/lib/microcosm/latest-artifact";
import { countryRegistration, hasCapability } from "@/lib/microcosm/countries";
import {
  type ReformValidation,
  buildReformValidation,
} from "@/lib/microcosm/reforms";
import {
  buildTargetChangeDataset,
  type TargetChangeDataset,
} from "@/lib/microcosm/target-change";
import {
  IncompatibleStagingDataError,
  parseStagingCalibrationProgress,
  parseStagingEvents,
  parseStagingManifest,
  parseStagingProgress,
  parseStagingRunIndex,
} from "@/lib/microcosm/staging-contract";

type JsonObject = Record<string, unknown>;

interface TargetChangeCacheEntry {
  expiresAt: number;
  promise: Promise<TargetChangeDataset | null>;
}

const TARGET_CHANGE_FINAL_CACHE_SECONDS = 21_600;
const TARGET_CHANGE_MUTABLE_CACHE_SECONDS = 30;
const TARGET_CHANGE_CACHE_LIMIT = 8;
const targetChangeCache = new Map<string, TargetChangeCacheEntry>();

export const MICROCOSM_STAGING_HF_REPO_ENV = "POPULACE_STAGING_HF_REPO";
export const MICROCOSM_STAGING_HF_REVISION_ENV = "POPULACE_STAGING_HF_REVISION";
export interface StagingRepository {
  repo: string;
  revision: string;
}

// Resolve staging telemetry from the country registry. The exported US values
// retain the legacy API and deployment-variable behavior for existing callers.
export function stagingRepository(country: MicrocosmCountry): StagingRepository | null {
  const staging = countryRegistration(country).staging;
  if (!hasCapability(country, "staging") || !staging) return null;
  return {
    repo:
      (staging.repo_env ? process.env[staging.repo_env] : undefined) ??
      staging.repo,
    revision:
      (staging.revision_env ? process.env[staging.revision_env] : undefined) ??
      staging.revision,
  };
}

export const MICROCOSM_STAGING_HF_REPO = stagingRepository("us")!.repo;
export const MICROCOSM_STAGING_HF_REVISION = stagingRepository("us")!.revision;

// Staging telemetry is served for countries registered with the `staging`
// capability. Repository and credential selection happens in this server data
// module and never enters the API response model.
export function stagingUnavailableReason(country: MicrocosmCountry): string | null {
  return stagingRepository(country)
    ? null
    : `${microcosmCountryGeography(country)} has no staging repository.`;
}

function requiredStagingRepository(country: MicrocosmCountry): StagingRepository {
  const repository = stagingRepository(country);
  if (repository) return repository;
  throw new Error(
    stagingUnavailableReason(country) ?? "Staging repository is not configured.",
  );
}

function stagingResolveUrlFor(repository: StagingRepository, path: string): string {
  return `https://huggingface.co/datasets/${repository.repo}/resolve/${repository.revision}/${path}`;
}

export function stagingResolveUrl(path: string, country: MicrocosmCountry = "us"): string {
  return stagingResolveUrlFor(requiredStagingRepository(country), path);
}

function stagingTreeUrl(repository: StagingRepository): string {
  return `https://huggingface.co/api/datasets/${repository.repo}/tree/${repository.revision}/runs?recursive=true`;
}

function stagingRepoUrl(repository: StagingRepository): string {
  return `https://huggingface.co/api/datasets/${repository.repo}`;
}

function stagingSource(country: MicrocosmCountry): StagingRepository {
  return requiredStagingRepository(country);
}

function unavailableStaging(country: MicrocosmCountry) {
  const detail = stagingUnavailableReason(country);
  if (!detail) return null;
  return {
    available: false as const,
    source_repo: null,
    revision: null,
    detail,
  };
}

class StagingFetchError extends Error {
  constructor(
    public readonly status: number,
    path: string,
    repository: StagingRepository,
  ) {
    super(stagingFetchMessage(status, path, repository));
  }
}

function stagingFetchMessage(
  status: number,
  path: string,
  repository: StagingRepository,
): string {
  if (status === 401 || status === 403) {
    return (
      `Staging repository ${repository.repo} is not readable by this deployment ` +
      `(${status} fetching ${path}). Configure its server-side read credential.`
    );
  }
  if (status === 404) {
    return `Staging artifact not found (${path}).`;
  }
  return `Staging fetch failed ${status}: ${path}`;
}

function stagingToken(country: MicrocosmCountry): string | undefined {
  const tokenEnv = countryRegistration(country).staging?.token_env;
  if (tokenEnv) return process.env[tokenEnv];
  return process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
}

function hfHeaders(country: MicrocosmCountry): HeadersInit | undefined {
  const token = stagingToken(country);
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function stagingFetchOptions(
  revalidate: number,
  country: MicrocosmCountry,
): RequestInit {
  return {
    headers: hfHeaders(country),
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }),
  };
}

async function stagingJson(
  path: string,
  revalidate: number,
  country: MicrocosmCountry,
): Promise<JsonObject> {
  const repository = stagingSource(country);
  const res = await fetch(
    stagingResolveUrlFor(repository, path),
    stagingFetchOptions(revalidate, country),
  );
  if (!res.ok) throw new StagingFetchError(res.status, path, repository);
  return asObject(await res.json());
}

async function stagingJsonOrNull(
  path: string,
  revalidate: number,
  country: MicrocosmCountry,
): Promise<JsonObject | null> {
  try {
    return await stagingJson(path, revalidate, country);
  } catch (error) {
    if (error instanceof StagingFetchError && error.status !== 404) throw error;
    return null;
  }
}

async function stagingTextOrNull(
  path: string,
  revalidate: number,
  country: MicrocosmCountry,
): Promise<string | null> {
  const repository = stagingSource(country);
  const res = await fetch(
    stagingResolveUrlFor(repository, path),
    stagingFetchOptions(revalidate, country),
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new StagingFetchError(res.status, path, repository);
  }
  return res.text();
}

async function stagingTree(
  revalidate: number,
  country: MicrocosmCountry,
): Promise<JsonObject[]> {
  const repository = stagingSource(country);
  const entries: JsonObject[] = [];
  const visited = new Set<string>();
  let url: string | null = stagingTreeUrl(repository);
  while (url) {
    if (visited.has(url)) {
      throw new Error("Staging repository tree pagination repeated a page URL.");
    }
    visited.add(url);
    const res: Response = await fetch(
      url,
      stagingFetchOptions(revalidate, country),
    );
    if (!res.ok) throw new StagingFetchError(res.status, "runs tree", repository);
    const tree = await res.json();
    if (Array.isArray(tree)) entries.push(...tree.map(asObject));
    const link = res.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
  }
  return entries;
}

export interface StagingRunSummary {
  run_id: string;
  candidate_release_id: string | null;
  release_id: string | null;
  country_code: string | null;
  run_kind: string | null;
  non_release: boolean | null;
  schema_version: 1 | 2 | null;
  status: string | null;
  stage: string | null;
  started_at: string | null;
  updated_at: string | null;
  progress_path: string;
  run_manifest_path: string;
}

export interface StagingRunDetail {
  available: boolean;
  source_repo: string | null;
  revision: string | null;
  detail?: string | null;
  run_id: string;
  candidate_release_id: string | null;
  release_id: string | null;
  country_code: string | null;
  run_kind: string | null;
  non_release: boolean | null;
  schema_version: 1 | 2 | null;
  delivery: JsonObject | null;
  progress: JsonObject | null;
  run_manifest: JsonObject | null;
  calibration_progress: JsonObject | null;
  events: JsonObject[];
  has_calibration: boolean;
  calibration: ReturnType<typeof latestMicrocosmCalibrationSummary> | null;
  reform_validation: ReformValidation | null;
  build_manifest: JsonObject | null;
  release_manifest: JsonObject | null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function schemaVersionValue(value: unknown): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

function objectOrNull(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function stagingTargetChangeCacheTtlSeconds(status: unknown): number {
  return ["passed", "published", "completed", "failed"].includes(
    String(status ?? "").trim(),
  )
    ? TARGET_CHANGE_FINAL_CACHE_SECONDS
    : TARGET_CHANGE_MUTABLE_CACHE_SECONDS;
}

function summaryFromProgress(runId: string, progress: JsonObject | null): StagingRunSummary {
  const candidate = stringValue(progress?.candidate_release_id);
  return {
    run_id: runId,
    candidate_release_id: candidate,
    release_id: stringValue(progress?.release_id),
    country_code: stringValue(progress?.country_code),
    run_kind: stringValue(progress?.run_kind),
    non_release: booleanValue(progress?.non_release),
    schema_version: schemaVersionValue(progress?.schema_version),
    status: stringValue(progress?.status),
    stage: stringValue(progress?.stage),
    started_at: stringValue(progress?.started_at),
    updated_at: stringValue(progress?.updated_at),
    progress_path: `runs/${runId}/progress.json`,
    run_manifest_path: `runs/${runId}/run_manifest.json`,
  };
}

function summaryFromManifest(
  runId: string,
  manifest: JsonObject,
): StagingRunSummary {
  return {
    run_id: runId,
    candidate_release_id: stringValue(manifest.candidate_release_id),
    release_id: stringValue(manifest.release_id),
    country_code: stringValue(manifest.country_code),
    run_kind: stringValue(manifest.run_kind),
    non_release: booleanValue(manifest.non_release),
    schema_version: 2,
    status: stringValue(manifest.status),
    stage: stringValue(manifest.stage),
    started_at: stringValue(manifest.started_at),
    updated_at: stringValue(manifest.updated_at),
    progress_path: `runs/${runId}/progress.json`,
    run_manifest_path: `runs/${runId}/run_manifest.json`,
  };
}

function sortRuns(a: StagingRunSummary, b: StagingRunSummary): number {
  return (
    String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) ||
    String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")) ||
    b.run_id.localeCompare(a.run_id)
  );
}

const RUN_PATH = /^runs\/([A-Za-z0-9][A-Za-z0-9._-]*)\//;
const RUN_MANIFEST_PATH =
  /^runs\/([A-Za-z0-9][A-Za-z0-9._-]*)\/run_manifest\.json$/;

export async function loadStagingRuns(
  revalidate: number,
  country: MicrocosmCountry = "us",
) {
  const unavailable = unavailableStaging(country);
  if (unavailable) {
    return {
      ...unavailable,
      truncated: false,
      runs: [] as StagingRunSummary[],
    };
  }
  const repository = stagingSource(country);
  let treeMissing = false;
  let tree: JsonObject[] = [];
  try {
    tree = await stagingTree(revalidate, country);
  } catch (error) {
    if (!(error instanceof StagingFetchError) || error.status !== 404) throw error;
    // A staging repo may exist before any tree listing is public.
    treeMissing = true;
  }

  const manifestPaths = new Map<string, string>();
  const listedRunIds = new Set<string>();
  for (const entry of tree) {
    if (entry.type !== "file" || typeof entry.path !== "string") continue;
    const runMatch = RUN_PATH.exec(entry.path);
    if (runMatch) listedRunIds.add(runMatch[1]);
    const manifestMatch = RUN_MANIFEST_PATH.exec(entry.path);
    if (manifestMatch) manifestPaths.set(manifestMatch[1], entry.path);
  }

  const listedManifests = await Promise.all(
    [...manifestPaths].map(async ([runId, path]) => {
      const manifest = parseStagingManifest(
        await stagingJson(path, revalidate, country),
      );
      if (manifest.run_id !== runId) {
        throw new IncompatibleStagingDataError(
          `run manifest id ${String(manifest.run_id)} does not match directory ${runId}.`,
        );
      }
      return manifest;
    }),
  );
  const v2Manifests = listedManifests.filter(
    (manifest) => manifest.schema_version === 2,
  );
  const v2ManifestIds = new Set(
    v2Manifests.map((manifest) => String(manifest.run_id)),
  );
  const v1ManifestIds = new Set(
    listedManifests
      .filter((manifest) => manifest.schema_version === 1)
      .map((manifest) => String(manifest.run_id)),
  );

  let index: JsonObject | null = null;
  let indexedRuns: StagingRunSummary[] = [];
  if (treeMissing || v1ManifestIds.size > 0) {
    index = await stagingJsonOrNull("runs.json", revalidate, country);
    if (index?.schema_version === 1) indexedRuns = parseStagingRunIndex(index);
  }

  // HF answers 404 (not 401/403) for private repos when auth is missing or
  // expired, so "everything 404'd" is ambiguous between "no runs yet" and "we
  // can't see the repo". Disambiguate via the repo API before reporting an
  // empty list — a silent empty state hides a broken token.
  if (index == null && treeMissing && listedManifests.length === 0) {
    const repoRes = await fetch(
      stagingRepoUrl(repository),
      stagingFetchOptions(revalidate, country),
    );
    if (!repoRes.ok) {
      return {
        available: false,
        source_repo: repository.repo,
        revision: repository.revision,
        detail:
          `Staging repository ${repository.repo} is not visible (HTTP ${repoRes.status}). ` +
          "It is private — a missing or expired HF token reads as 404, not 401.",
        runs: [],
      };
    }
  }

  const byId = new Map<string, StagingRunSummary>(
    indexedRuns.map((run) => [run.run_id, run]),
  );
  const v1RunIds = new Set(v1ManifestIds);
  if (index?.schema_version === 1) {
    for (const runId of listedRunIds) {
      if (!v2ManifestIds.has(runId)) v1RunIds.add(runId);
    }
  }
  const missing = [...v1RunIds]
    .filter((runId) => !byId.has(runId))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const MAX_UNINDEXED_FETCH = 50;
  const fetched = await Promise.all(
    missing.slice(0, MAX_UNINDEXED_FETCH).map(async (runId) => {
      const raw = await stagingJsonOrNull(
        `runs/${runId}/progress.json`,
        revalidate,
        country,
      );
      return summaryFromProgress(runId, raw == null ? null : parseStagingProgress(raw));
    }),
  );
  for (const run of fetched) byId.set(run.run_id, run);
  for (const manifest of v2Manifests) {
    const runId = String(manifest.run_id);
    byId.set(runId, summaryFromManifest(runId, manifest));
  }
  const truncated = missing.length > MAX_UNINDEXED_FETCH;

  return {
    available: true,
    source_repo: repository.repo,
    revision: repository.revision,
    truncated,
    runs: [...byId.values()].sort(sortRuns),
  };
}

export async function loadStagingCalibration(
  runId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<Calibration | null> {
  if (stagingUnavailableReason(country)) return null;
  assertSafeReleaseId(runId, "run");
  const progressRaw = await stagingJsonOrNull(
    `runs/${runId}/progress.json`,
    revalidate,
    country,
  );
  const progress = progressRaw == null ? null : parseStagingProgress(progressRaw);
  const candidateReleaseId = stringValue(progress?.candidate_release_id) ?? runId;
  const diag = await stagingJsonOrNull(
    `runs/${runId}/calibration_diagnostics.json`,
    revalidate,
    country,
  );
  if (!diag) return null;
  const [buildManifest, releaseManifest] = await Promise.all([
    stagingJsonOrNull(`runs/${runId}/build_manifest.json`, revalidate, country),
    stagingJsonOrNull(`runs/${runId}/release_manifest.json`, revalidate, country),
  ]);
  return buildCalibration(
    diag,
    candidateReleaseId,
    stringValue(progress?.updated_at),
    buildManifest ?? {},
    releaseManifest ?? {},
    {},
    country,
  );
}

export async function loadStagingTargetChangeDataset(
  runId: string,
  releaseId: string,
  country: MicrocosmCountry = "us",
): Promise<TargetChangeDataset | null> {
  if (stagingUnavailableReason(country)) return null;
  assertSafeReleaseId(runId, "run");
  assertSafeReleaseId(releaseId, "release");
  const progress = await stagingJsonOrNull(
    `runs/${runId}/progress.json`,
    TARGET_CHANGE_MUTABLE_CACHE_SECONDS,
    country,
  );
  const parsedProgress = progress == null ? null : parseStagingProgress(progress);
  const ttlSeconds = stagingTargetChangeCacheTtlSeconds(parsedProgress?.status);
  const cacheKey = `${country}:${runId}:${releaseId}`;
  const now = Date.now();
  for (const [key, entry] of targetChangeCache) {
    if (entry.expiresAt <= now) targetChangeCache.delete(key);
  }
  const cached = targetChangeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = Promise.all([
    loadRelease(releaseId, TARGET_CHANGE_FINAL_CACHE_SECONDS, country),
    loadStagingCalibration(runId, ttlSeconds, country),
  ]).then(([release, candidate]) =>
    candidate ? buildTargetChangeDataset(release, candidate) : null,
  );
  targetChangeCache.set(cacheKey, {
    expiresAt: now + ttlSeconds * 1000,
    promise,
  });
  while (targetChangeCache.size > TARGET_CHANGE_CACHE_LIMIT) {
    const oldest = targetChangeCache.keys().next().value;
    if (typeof oldest !== "string") break;
    targetChangeCache.delete(oldest);
  }
  try {
    const result = await promise;
    if (!result) targetChangeCache.delete(cacheKey);
    return result;
  } catch (error) {
    targetChangeCache.delete(cacheKey);
    throw error;
  }
}

export async function loadStagingRun(
  runId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<StagingRunDetail> {
  const unavailable = unavailableStaging(country);
  if (unavailable) {
    return {
      ...unavailable,
      run_id: runId,
      candidate_release_id: null,
      release_id: null,
      country_code: null,
      run_kind: null,
      non_release: null,
      schema_version: null,
      delivery: null,
      progress: null,
      run_manifest: null,
      calibration_progress: null,
      events: [],
      has_calibration: false,
      calibration: null,
      reform_validation: null,
      build_manifest: null,
      release_manifest: null,
    };
  }
  assertSafeReleaseId(runId, "run");
  const repository = stagingSource(country);
  const [
    progressRaw,
    runManifestRaw,
    calibrationProgressRaw,
    eventsText,
    cal,
    reformValidationRaw,
  ] = await Promise.all([
    stagingJsonOrNull(`runs/${runId}/progress.json`, revalidate, country),
    stagingJsonOrNull(`runs/${runId}/run_manifest.json`, revalidate, country),
    stagingJsonOrNull(
      `runs/${runId}/calibration_progress.json`,
      revalidate,
      country,
    ),
    stagingTextOrNull(`runs/${runId}/events.ndjson`, revalidate, country),
    loadStagingCalibration(runId, revalidate, country),
    stagingJsonOrNull(`runs/${runId}/reform_validation.json`, revalidate, country),
  ]);
  const progress = progressRaw == null ? null : parseStagingProgress(progressRaw);
  const runManifest =
    runManifestRaw == null ? null : parseStagingManifest(runManifestRaw);
  const calibrationProgress =
    calibrationProgressRaw == null
      ? null
      : parseStagingCalibrationProgress(calibrationProgressRaw);
  const candidateReleaseId =
    stringValue(progress?.candidate_release_id) ??
    stringValue(runManifest?.candidate_release_id) ??
    runId;
  const identity = progress ?? runManifest;
  return {
    available: true,
    source_repo: repository.repo,
    revision: repository.revision,
    run_id: runId,
    candidate_release_id: candidateReleaseId,
    release_id: stringValue(identity?.release_id),
    country_code: stringValue(identity?.country_code),
    run_kind: stringValue(identity?.run_kind),
    non_release: booleanValue(identity?.non_release),
    schema_version: schemaVersionValue(identity?.schema_version),
    delivery: objectOrNull(identity?.delivery),
    progress,
    run_manifest: runManifest,
    calibration_progress: calibrationProgress,
    events: parseStagingEvents(eventsText),
    has_calibration: cal != null,
    calibration: cal ? latestMicrocosmCalibrationSummary(cal) : null,
    reform_validation: reformValidationRaw
      ? buildReformValidation(
          reformValidationRaw,
          candidateReleaseId,
          stringValue(progress?.updated_at),
        )
      : null,
    build_manifest: cal?.build_manifest ?? null,
    release_manifest: cal?.release_manifest ?? null,
  };
}

export async function loadStagingReformValidationRaw(
  runId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<JsonObject | null> {
  if (stagingUnavailableReason(country)) return null;
  assertSafeReleaseId(runId, "run");
  return stagingJsonOrNull(
    `runs/${runId}/reform_validation.json`,
    revalidate,
    country,
  );
}

export async function loadStagingTargetDiagnostics(
  requestUrl: string,
  runId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
) {
  const unavailable = unavailableStaging(country);
  if (unavailable) return { ...unavailable, run_id: runId };
  const cal = await loadStagingCalibration(runId, revalidate, country);
  if (!cal) {
    return {
      available: false,
      run_id: runId,
      detail: "This staging run has not uploaded calibration_diagnostics.json yet.",
    };
  }
  return latestMicrocosmTargetDiagnosticsPage(requestUrl, cal);
}

export async function loadStagingComparison(
  runId: string,
  releaseId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
) {
  const unavailable = unavailableStaging(country);
  if (unavailable) return { ...unavailable, run_id: runId };
  const [release, staging] = await Promise.all([
    loadRelease(releaseId || "latest", revalidate, country),
    loadStagingCalibration(runId, revalidate, country),
  ]);
  if (!staging) {
    return {
      available: false,
      run_id: runId,
      detail: "This staging run has not uploaded calibration_diagnostics.json yet.",
    };
  }
  return {
    available: true,
    run_id: runId,
    ...buildComparison(release, staging),
  };
}
