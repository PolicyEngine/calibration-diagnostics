import {
  type BuildForecast,
  type BuildRunDocuments,
  type BuildRunSource,
  type BuildTimeline,
  type GateStat,
  type PhaseTotals,
  type StageStat,
  buildTimeline,
  compactTimeline,
  type FailureClassStat,
  failureClassStatistics,
  forecastCompletion,
  gateStatistics,
  phaseTotals,
  stageStatistics,
} from "@/lib/microcosm/build-monitor";
import { type CatalogGate, gateCatalogForPipeline } from "@/lib/microcosm/build-gate-catalog";
import { hasCapability, type MicrocosmCountry } from "@/lib/microcosm/countries";
import {
  discoverLocalRuns,
  loadLocalRunDocuments,
  localRunCountry,
  localRunRoots,
} from "@/lib/microcosm/local-build-runs";
import { loadStagingRuns, loadStagingRunTelemetry } from "@/lib/microcosm/staging-artifact";
import {
  collectorConfigured,
  loadCollectorRun,
  loadCollectorRuns,
} from "@/lib/microcosm/telemetry-collector";

// Server-side assembly for the build monitor: load every run's telemetry from
// one source, turn it into timelines, and derive the forecast and cross-run
// statistics for the selected run's pipeline.

const STAGING_LIST_TTL_MS = 30_000;
const STAGING_RUN_LIMIT = 60;

export interface BuildRunProblem {
  run_id: string;
  detail: string;
}

export interface BuildRunsResponse {
  source: BuildRunSource;
  country: MicrocosmCountry;
  available: boolean;
  detail: string | null;
  local_enabled: boolean;
  roots: string[];
  now_ms: number;
  runs: BuildTimeline[];
  problems: BuildRunProblem[];
}

export interface BuildRunResponse {
  source: BuildRunSource;
  country: MicrocosmCountry;
  now_ms: number;
  run: BuildTimeline;
  forecast: BuildForecast | null;
  pipeline_runs: number;
  stage_stats: StageStat[];
  gate_stats: GateStat[];
  failure_classes: FailureClassStat[];
  phase_totals: PhaseTotals[];
  gate_catalog: CatalogGate[] | null;
}

interface CachedRun {
  documents: BuildRunDocuments;
  final: boolean;
}

// Finished staging runs never change, so their telemetry is fetched once.
const stagingRunCache = new Map<string, CachedRun>();
const stagingListCache = new Map<string, { expiresAt: number; promise: Promise<LoadedRuns> }>();

interface LoadedRuns {
  available: boolean;
  detail: string | null;
  documents: BuildRunDocuments[];
  problems: BuildRunProblem[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFinal(documents: BuildRunDocuments): boolean {
  const status = documents.progress?.status ?? documents.run_manifest?.status;
  return status === "passed" || status === "completed" || status === "failed";
}

async function loadLocal(country: MicrocosmCountry): Promise<LoadedRuns> {
  const roots = localRunRoots();
  if (!roots.length) {
    return {
      available: false,
      detail: "Local runs are off. Set MICROCOSM_LOCAL_RUNS_DIR to the folder your builds write to.",
      documents: [],
      problems: [],
    };
  }
  const locations = await discoverLocalRuns(roots);
  const documents: BuildRunDocuments[] = [];
  const problems: BuildRunProblem[] = [];
  await Promise.all(
    locations.map(async (location) => {
      try {
        const loaded = await loadLocalRunDocuments(location, country);
        if (localRunCountry(loaded) === country) documents.push(loaded);
      } catch (error) {
        problems.push({ run_id: location.run_id, detail: message(error) });
      }
    }),
  );
  return { available: true, detail: null, documents, problems };
}

async function loadHuggingFaceStaging(country: MicrocosmCountry): Promise<LoadedRuns> {
  if (!hasCapability(country, "staging")) {
    return {
      available: false,
      detail: "This country has no staging repository.",
      documents: [],
      problems: [],
    };
  }
  const list = await loadStagingRuns(0, country);
  if (!list.available) {
    return {
      available: false,
      detail: ("detail" in list ? list.detail : null) ?? "Staging runs are unavailable.",
      documents: [],
      problems: [],
    };
  }
  const problems: BuildRunProblem[] = (list.incompatible_runs ?? []).map((run) => ({
    run_id: run.run_id,
    detail: run.detail,
  }));
  const documents: BuildRunDocuments[] = [];
  await Promise.all(
    list.runs.slice(0, STAGING_RUN_LIMIT).map(async (summary) => {
      const key = `${country}:${summary.run_id}`;
      const cached = stagingRunCache.get(key);
      if (cached?.final) {
        documents.push(cached.documents);
        return;
      }
      try {
        const telemetry = await loadStagingRunTelemetry(summary.run_id, 0, country);
        const loaded: BuildRunDocuments = { ...telemetry, source: "staging", country };
        stagingRunCache.set(key, { documents: loaded, final: isFinal(loaded) });
        documents.push(loaded);
      } catch (error) {
        problems.push({ run_id: summary.run_id, detail: message(error) });
      }
    }),
  );
  return { available: true, detail: null, documents, problems };
}

async function loadCollector(country: MicrocosmCountry): Promise<LoadedRuns> {
  const summaries = await loadCollectorRuns(country);
  const documents: BuildRunDocuments[] = [];
  const problems: BuildRunProblem[] = [];
  await Promise.all(
    summaries.slice(0, STAGING_RUN_LIMIT).map(async (summary) => {
      const key = `collector:${country}:${summary.run_id}`;
      const cached = stagingRunCache.get(key);
      if (cached?.final) {
        documents.push(cached.documents);
        return;
      }
      try {
        const loaded = await loadCollectorRun(summary.run_id, country);
        stagingRunCache.set(key, { documents: loaded, final: isFinal(loaded) });
        documents.push(loaded);
      } catch (error) {
        problems.push({ run_id: summary.run_id, detail: message(error) });
      }
    }),
  );
  return { available: true, detail: null, documents, problems };
}

async function loadStaging(country: MicrocosmCountry): Promise<LoadedRuns> {
  const hosted: LoadedRuns[] = [];
  const sourceProblems: BuildRunProblem[] = [];
  if (collectorConfigured()) {
    try {
      hosted.push(await loadCollector(country));
    } catch (error) {
      sourceProblems.push({
        run_id: "collector",
        detail: message(error),
      });
    }
  }
  try {
    hosted.push(await loadHuggingFaceStaging(country));
  } catch (error) {
    sourceProblems.push({
      run_id: "hugging-face-history",
      detail: message(error),
    });
  }
  const available = hosted.some((source) => source.available);
  const byId = new Map<string, BuildRunDocuments>();
  // Historical Hugging Face documents enter first; collector documents are
  // newer and replace the same run id during the migration period.
  for (const source of [...hosted].reverse()) {
    for (const document of source.documents) byId.set(document.run_id, document);
  }
  return {
    available,
    detail: available
      ? null
      : hosted.map((source) => source.detail).filter(Boolean).join(" ") ||
        "Hosted build telemetry is unavailable.",
    documents: [...byId.values()],
    problems: [
      ...hosted.flatMap((source) => source.problems),
      ...sourceProblems,
    ],
  };
}

function loadRuns(source: BuildRunSource, country: MicrocosmCountry): Promise<LoadedRuns> {
  if (source === "local") return loadLocal(country);
  const key = country;
  const cached = stagingListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = loadStaging(country);
  stagingListCache.set(key, { expiresAt: Date.now() + STAGING_LIST_TTL_MS, promise });
  promise.catch(() => stagingListCache.delete(key));
  return promise;
}

function timelines(documents: BuildRunDocuments[], nowMs: number): BuildTimeline[] {
  return documents
    .map((document) => buildTimeline(document, nowMs))
    .sort((a, b) => (b.started_ms ?? 0) - (a.started_ms ?? 0));
}

export async function loadBuildRuns(
  source: BuildRunSource,
  country: MicrocosmCountry,
): Promise<BuildRunsResponse> {
  const nowMs = Date.now();
  const loaded = await loadRuns(source, country);
  return {
    source,
    country,
    available: loaded.available,
    detail: loaded.detail,
    local_enabled: localRunRoots().length > 0,
    roots: source === "local" ? localRunRoots() : [],
    now_ms: nowMs,
    runs: timelines(loaded.documents, nowMs).map(compactTimeline),
    problems: loaded.problems,
  };
}

export async function loadBuildRun(
  source: BuildRunSource,
  country: MicrocosmCountry,
  runId: string,
): Promise<BuildRunResponse | null> {
  const nowMs = Date.now();
  const loaded = await loadRuns(source, country);
  const all = timelines(loaded.documents, nowMs);
  let run = all.find((timeline) => timeline.run_id === runId) ?? null;
  // A running staging run may be newer than the cached list; read it fresh.
  if (source === "staging" && (run == null || run.state === "running")) {
    if (collectorConfigured()) {
      try {
        const telemetry = await loadCollectorRun(runId, country);
        run = buildTimeline(telemetry, nowMs);
      } catch (error) {
        if (run == null && !hasCapability(country, "staging")) throw error;
      }
    }
  }
  if (source === "staging" && (run == null || run.state === "running")) {
    try {
      const telemetry = await loadStagingRunTelemetry(runId, 0, country);
      run = buildTimeline({ ...telemetry, source, country }, nowMs);
    } catch (error) {
      if (run == null) throw error;
    }
  }
  if (run == null) return null;
  const pipelineRuns = all.filter((timeline) => timeline.pipeline === run!.pipeline);
  return {
    source,
    country,
    now_ms: nowMs,
    run,
    forecast: forecastCompletion(run, all, nowMs),
    pipeline_runs: pipelineRuns.length,
    stage_stats: stageStatistics(pipelineRuns.filter((timeline) => timeline.state !== "running")),
    gate_stats: gateStatistics(pipelineRuns),
    failure_classes: failureClassStatistics(pipelineRuns),
    phase_totals: pipelineRuns.map((timeline) => phaseTotals(timeline, nowMs)),
    gate_catalog: gateCatalogForPipeline(run.pipeline),
  };
}
