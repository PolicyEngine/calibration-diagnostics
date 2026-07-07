import {
  type Calibration,
  asObject,
  assertSafeReleaseId,
  buildCalibration,
  buildComparison,
  latestPopulaceCalibrationSummary,
  latestPopulaceTargetDiagnosticsPage,
  loadRelease,
} from "@/lib/populace/latest-artifact";
import {
  type ReformValidation,
  buildReformValidation,
} from "@/lib/populace/reforms";

type JsonObject = Record<string, unknown>;

export const POPULACE_STAGING_HF_REPO =
  process.env.POPULACE_STAGING_HF_REPO ?? "policyengine/populace-us-staging";
export const POPULACE_STAGING_HF_REVISION =
  process.env.POPULACE_STAGING_HF_REVISION ?? "main";

class StagingFetchError extends Error {
  constructor(
    public readonly status: number,
    path: string,
  ) {
    super(stagingFetchMessage(status, path));
  }
}

function stagingFetchMessage(status: number, path: string): string {
  if (status === 401 || status === 403) {
    return (
      `Staging repo ${POPULACE_STAGING_HF_REPO} is not readable by this deployment ` +
      `(${status} fetching ${path}). Set HF_TOKEN/HUGGINGFACE_TOKEN on the server, ` +
      "or publish staging telemetry to a public dataset repo."
    );
  }
  if (status === 404) {
    return `Staging artifact not found (${path}).`;
  }
  return `Staging fetch failed ${status}: ${path}`;
}

function hfHeaders(): HeadersInit | undefined {
  const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export function stagingResolveUrl(path: string): string {
  return `https://huggingface.co/datasets/${POPULACE_STAGING_HF_REPO}/resolve/${POPULACE_STAGING_HF_REVISION}/${path}`;
}

function stagingFetchOptions(revalidate: number): RequestInit {
  return {
    headers: hfHeaders(),
    ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" as const }),
  };
}

async function stagingJson(path: string, revalidate: number): Promise<JsonObject> {
  const res = await fetch(stagingResolveUrl(path), stagingFetchOptions(revalidate));
  if (!res.ok) throw new StagingFetchError(res.status, path);
  return asObject(await res.json());
}

async function stagingJsonOrNull(path: string, revalidate: number): Promise<JsonObject | null> {
  try {
    return await stagingJson(path, revalidate);
  } catch (error) {
    if (error instanceof StagingFetchError && error.status !== 404) throw error;
    return null;
  }
}

async function stagingTextOrNull(path: string, revalidate: number): Promise<string | null> {
  const res = await fetch(stagingResolveUrl(path), stagingFetchOptions(revalidate));
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new StagingFetchError(res.status, path);
  }
  return res.text();
}

async function stagingTree(revalidate: number): Promise<JsonObject[]> {
  const url = `https://huggingface.co/api/datasets/${POPULACE_STAGING_HF_REPO}/tree/${POPULACE_STAGING_HF_REVISION}/runs?recursive=true`;
  const res = await fetch(url, stagingFetchOptions(revalidate));
  if (!res.ok) throw new StagingFetchError(res.status, "runs tree");
  const tree = await res.json();
  return Array.isArray(tree) ? tree.map(asObject) : [];
}

export interface StagingRunSummary {
  run_id: string;
  candidate_release_id: string | null;
  status: string | null;
  stage: string | null;
  started_at: string | null;
  updated_at: string | null;
  progress_path: string;
  run_manifest_path: string;
}

export interface StagingRunDetail {
  available: boolean;
  source_repo: string;
  revision: string;
  run_id: string;
  candidate_release_id: string | null;
  progress: JsonObject | null;
  run_manifest: JsonObject | null;
  calibration_progress: JsonObject | null;
  events: JsonObject[];
  has_calibration: boolean;
  calibration: ReturnType<typeof latestPopulaceCalibrationSummary> | null;
  reform_validation: ReformValidation | null;
  build_manifest: JsonObject | null;
  release_manifest: JsonObject | null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function summaryFromProgress(runId: string, progress: JsonObject | null): StagingRunSummary {
  const candidate = stringValue(progress?.candidate_release_id);
  return {
    run_id: runId,
    candidate_release_id: candidate,
    status: stringValue(progress?.status),
    stage: stringValue(progress?.stage),
    started_at: stringValue(progress?.started_at),
    updated_at: stringValue(progress?.updated_at),
    progress_path: `runs/${runId}/progress.json`,
    run_manifest_path: `runs/${runId}/run_manifest.json`,
  };
}

function sortRuns(a: StagingRunSummary, b: StagingRunSummary): number {
  return String(b.updated_at ?? b.started_at ?? b.run_id).localeCompare(
    String(a.updated_at ?? a.started_at ?? a.run_id),
  );
}

export async function loadStagingRuns(revalidate: number) {
  const index = await stagingJsonOrNull("runs.json", revalidate);
  const indexedRuns = Array.isArray(index?.runs)
    ? (index.runs as JsonObject[])
        .map((row) => {
          const runId = stringValue(row.run_id);
          return runId
            ? {
                run_id: runId,
                candidate_release_id: stringValue(row.candidate_release_id),
                status: stringValue(row.status),
                stage: stringValue(row.stage),
                started_at: stringValue(row.started_at),
                updated_at: stringValue(row.updated_at),
                progress_path:
                  stringValue(row.progress_path) ?? `runs/${runId}/progress.json`,
                run_manifest_path:
                  stringValue(row.run_manifest_path) ?? `runs/${runId}/run_manifest.json`,
              }
            : null;
        })
        .filter((row): row is StagingRunSummary => row != null)
    : [];

  // Always union the index with the actual run directories: runs.json can lag
  // behind (or only carry the latest run), so list runs/ and pick up any run
  // folder that isn't already indexed.
  const runIds = new Set(indexedRuns.map((run) => run.run_id));
  let treeMissing = false;
  try {
    for (const entry of await stagingTree(revalidate)) {
      if (typeof entry.path !== "string") continue;
      const match = /^runs\/([^/]+)\//.exec(entry.path);
      if (match) runIds.add(match[1]);
    }
  } catch (error) {
    if (error instanceof StagingFetchError && error.status !== 404) throw error;
    // A staging repo may exist before any tree listing is public.
    treeMissing = true;
  }

  // HF answers 404 (not 401/403) for private repos when auth is missing or
  // expired, so "everything 404'd" is ambiguous between "no runs yet" and "we
  // can't see the repo". Disambiguate via the repo API before reporting an
  // empty list — a silent empty state hides a broken token.
  if (index == null && treeMissing && runIds.size === 0) {
    const repoRes = await fetch(
      `https://huggingface.co/api/datasets/${POPULACE_STAGING_HF_REPO}`,
      stagingFetchOptions(revalidate),
    );
    if (!repoRes.ok) {
      return {
        available: false,
        source_repo: POPULACE_STAGING_HF_REPO,
        revision: POPULACE_STAGING_HF_REVISION,
        detail:
          `Staging repo ${POPULACE_STAGING_HF_REPO} is not visible (HTTP ${repoRes.status}). ` +
          "It is private — a missing or expired HF token reads as 404, not 401.",
        runs: [],
      };
    }
  }

  const byId = new Map(indexedRuns.map((run) => [run.run_id, run]));
  // Run ids are timestamp-prefixed, so descending order is newest-first: if
  // there are more un-indexed runs than the fetch cap, keep the newest rather
  // than dropping them arbitrarily (they'd otherwise silently vanish).
  const missing = [...runIds]
    .filter((runId) => !byId.has(runId))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const MAX_UNINDEXED_FETCH = 50;
  const fetched = await Promise.all(
    missing.slice(0, MAX_UNINDEXED_FETCH).map(async (runId) => {
      const progress = await stagingJsonOrNull(`runs/${runId}/progress.json`, revalidate);
      return summaryFromProgress(runId, progress);
    }),
  );
  for (const run of fetched) byId.set(run.run_id, run);
  const truncated = missing.length > MAX_UNINDEXED_FETCH;

  return {
    available: true,
    source_repo: POPULACE_STAGING_HF_REPO,
    revision: POPULACE_STAGING_HF_REVISION,
    truncated,
    runs: [...byId.values()].sort(sortRuns),
  };
}

function parseNdjson(text: string | null): JsonObject[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return asObject(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((row): row is JsonObject => row != null);
}

export async function loadStagingCalibration(
  runId: string,
  revalidate: number,
): Promise<Calibration | null> {
  assertSafeReleaseId(runId, "run");
  const progress = await stagingJsonOrNull(`runs/${runId}/progress.json`, revalidate);
  const candidateReleaseId = stringValue(progress?.candidate_release_id) ?? runId;
  const diag = await stagingJsonOrNull(
    `runs/${runId}/calibration_diagnostics.json`,
    revalidate,
  );
  if (!diag) return null;
  const [buildManifest, releaseManifest] = await Promise.all([
    stagingJsonOrNull(`runs/${runId}/build_manifest.json`, revalidate),
    stagingJsonOrNull(`runs/${runId}/release_manifest.json`, revalidate),
  ]);
  return buildCalibration(
    diag,
    candidateReleaseId,
    stringValue(progress?.updated_at),
    buildManifest ?? {},
    releaseManifest ?? {},
  );
}

export async function loadStagingRun(runId: string, revalidate: number): Promise<StagingRunDetail> {
  assertSafeReleaseId(runId, "run");
  const [
    progress,
    runManifest,
    calibrationProgress,
    eventsText,
    cal,
    reformValidationRaw,
  ] = await Promise.all([
    stagingJsonOrNull(`runs/${runId}/progress.json`, revalidate),
    stagingJsonOrNull(`runs/${runId}/run_manifest.json`, revalidate),
    stagingJsonOrNull(`runs/${runId}/calibration_progress.json`, revalidate),
    stagingTextOrNull(`runs/${runId}/events.ndjson`, revalidate),
    loadStagingCalibration(runId, revalidate),
    stagingJsonOrNull(`runs/${runId}/reform_validation.json`, revalidate),
  ]);
  const candidateReleaseId =
    stringValue(progress?.candidate_release_id) ??
    stringValue(runManifest?.candidate_release_id) ??
    runId;
  return {
    available: true,
    source_repo: POPULACE_STAGING_HF_REPO,
    revision: POPULACE_STAGING_HF_REVISION,
    run_id: runId,
    candidate_release_id: candidateReleaseId,
    progress,
    run_manifest: runManifest,
    calibration_progress: calibrationProgress,
    events: parseNdjson(eventsText),
    has_calibration: cal != null,
    calibration: cal ? latestPopulaceCalibrationSummary(cal) : null,
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
): Promise<JsonObject | null> {
  assertSafeReleaseId(runId, "run");
  return stagingJsonOrNull(`runs/${runId}/reform_validation.json`, revalidate);
}

export async function loadStagingTargetDiagnostics(
  requestUrl: string,
  runId: string,
  revalidate: number,
) {
  const cal = await loadStagingCalibration(runId, revalidate);
  if (!cal) {
    return {
      available: false,
      run_id: runId,
      detail: "This staging run has not uploaded calibration_diagnostics.json yet.",
    };
  }
  return latestPopulaceTargetDiagnosticsPage(requestUrl, cal);
}

export async function loadStagingComparison(
  runId: string,
  releaseId: string,
  revalidate: number,
) {
  const [release, staging] = await Promise.all([
    loadRelease(releaseId || "latest", revalidate),
    loadStagingCalibration(runId, revalidate),
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
