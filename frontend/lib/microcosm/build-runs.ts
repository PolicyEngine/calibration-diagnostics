import {
  type BuildForecast,
  type BuildRunDocuments,
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
import {
  type CatalogGate,
  gateCatalogForPipeline,
} from "@/lib/microcosm/build-gate-catalog";
import {
  hasCapability,
  type MicrocosmCountry,
} from "@/lib/microcosm/countries";
import {
  loadStagingRuns,
  loadStagingRunTelemetry,
} from "@/lib/microcosm/staging-artifact";
import {
  collectorConfigured,
  loadCollectorRun,
  loadCollectorRuns,
} from "@/lib/microcosm/telemetry-collector";

// Server-side assembly for the build monitor: combine hosted telemetry, turn
// it into timelines, and derive the forecast and cross-run statistics for the
// selected run's pipeline.

const HOSTED_LIST_TTL_MS = 30_000;
const HOSTED_RUN_LIMIT = 60;

export interface BuildRunProblem {
  run_id: string;
  detail: string;
}

export interface BuildRunsResponse {
  country: MicrocosmCountry;
  available: boolean;
  detail: string | null;
  now_ms: number;
  runs: BuildTimeline[];
  problems: BuildRunProblem[];
}

export interface BuildRunResponse {
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
const hostedRunCache = new Map<string, CachedRun>();
const hostedListCache = new Map<
  string,
  { expiresAt: number; promise: Promise<LoadedRuns> }
>();

interface LoadedRuns {
  available: boolean;
  detail: string | null;
  documents: BuildRunDocuments[];
  problems: BuildRunProblem[];
}

export interface HostedRunLoaders {
  collectorConfigured: () => boolean;
  hasStagingHistory: (country: MicrocosmCountry) => boolean;
  loadCollector: (
    runId: string,
    country: MicrocosmCountry,
  ) => Promise<BuildRunDocuments>;
  loadHistory: (
    runId: string,
    country: MicrocosmCountry,
  ) => Promise<BuildRunDocuments>;
}

const hostedRunLoaders: HostedRunLoaders = {
  collectorConfigured,
  hasStagingHistory: (country) => hasCapability(country, "staging"),
  loadCollector: loadCollectorRun,
  loadHistory: async (runId, country) => ({
    ...(await loadStagingRunTelemetry(runId, 0, country)),
    country,
  }),
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFinal(documents: BuildRunDocuments): boolean {
  const status = documents.progress?.status ?? documents.run_manifest?.status;
  return status === "passed" || status === "completed" || status === "failed";
}

async function loadHuggingFaceStaging(
  country: MicrocosmCountry,
): Promise<LoadedRuns> {
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
      detail:
        ("detail" in list ? list.detail : null) ??
        "Staging runs are unavailable.",
      documents: [],
      problems: [],
    };
  }
  const problems: BuildRunProblem[] = (list.incompatible_runs ?? []).map(
    (run) => ({
      run_id: run.run_id,
      detail: run.detail,
    }),
  );
  const documents: BuildRunDocuments[] = [];
  await Promise.all(
    list.runs.slice(0, HOSTED_RUN_LIMIT).map(async (summary) => {
      const key = `${country}:${summary.run_id}`;
      const cached = hostedRunCache.get(key);
      if (cached?.final) {
        documents.push(cached.documents);
        return;
      }
      try {
        const telemetry = await loadStagingRunTelemetry(
          summary.run_id,
          0,
          country,
        );
        const loaded: BuildRunDocuments = {
          ...telemetry,
          country,
        };
        hostedRunCache.set(key, { documents: loaded, final: isFinal(loaded) });
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
    summaries.slice(0, HOSTED_RUN_LIMIT).map(async (summary) => {
      const key = `collector:${country}:${summary.run_id}`;
      const cached = hostedRunCache.get(key);
      if (cached?.final) {
        documents.push(cached.documents);
        return;
      }
      try {
        const loaded = await loadCollectorRun(summary.run_id, country);
        hostedRunCache.set(key, { documents: loaded, final: isFinal(loaded) });
        documents.push(loaded);
      } catch (error) {
        problems.push({ run_id: summary.run_id, detail: message(error) });
      }
    }),
  );
  return { available: true, detail: null, documents, problems };
}

async function loadHosted(country: MicrocosmCountry): Promise<LoadedRuns> {
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
    for (const document of source.documents)
      byId.set(document.run_id, document);
  }
  return {
    available,
    detail: available
      ? null
      : hosted
          .map((source) => source.detail)
          .filter(Boolean)
          .join(" ") || "Hosted build telemetry is unavailable.",
    documents: [...byId.values()],
    problems: [
      ...hosted.flatMap((source) => source.problems),
      ...sourceProblems,
    ],
  };
}

function loadRuns(country: MicrocosmCountry): Promise<LoadedRuns> {
  const key = country;
  const cached = hostedListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = loadHosted(country);
  hostedListCache.set(key, {
    expiresAt: Date.now() + HOSTED_LIST_TTL_MS,
    promise,
  });
  promise.catch(() => hostedListCache.delete(key));
  return promise;
}

function timelines(
  documents: BuildRunDocuments[],
  nowMs: number,
): BuildTimeline[] {
  return documents
    .map((document) => buildTimeline(document, nowMs))
    .sort((a, b) => (b.started_ms ?? 0) - (a.started_ms ?? 0));
}

export async function refreshHostedRun(
  current: BuildTimeline | null,
  country: MicrocosmCountry,
  runId: string,
  nowMs: number,
  loaders: HostedRunLoaders = hostedRunLoaders,
): Promise<BuildTimeline | null> {
  if (current != null && current.state !== "running") return current;

  let collectorError: unknown = null;
  if (loaders.collectorConfigured()) {
    try {
      return buildTimeline(await loaders.loadCollector(runId, country), nowMs);
    } catch (error) {
      collectorError = error;
    }
  }
  if (!loaders.hasStagingHistory(country)) {
    if (current == null && collectorError != null) throw collectorError;
    return current;
  }
  try {
    return buildTimeline(await loaders.loadHistory(runId, country), nowMs);
  } catch (error) {
    if (current == null) throw error;
    return current;
  }
}

export async function loadBuildRuns(
  country: MicrocosmCountry,
): Promise<BuildRunsResponse> {
  const nowMs = Date.now();
  const loaded = await loadRuns(country);
  return {
    country,
    available: loaded.available,
    detail: loaded.detail,
    now_ms: nowMs,
    runs: timelines(loaded.documents, nowMs).map(compactTimeline),
    problems: loaded.problems,
  };
}

export async function loadBuildRun(
  country: MicrocosmCountry,
  runId: string,
): Promise<BuildRunResponse | null> {
  const nowMs = Date.now();
  const loaded = await loadRuns(country);
  const all = timelines(loaded.documents, nowMs);
  let run = all.find((timeline) => timeline.run_id === runId) ?? null;
  // A running hosted run may be newer than the cached list. The live
  // collector is authoritative when it responds; staged files are fallback.
  run = await refreshHostedRun(run, country, runId, nowMs);
  if (run == null) return null;
  const currentRuns = [
    ...all.filter((timeline) => timeline.run_id !== runId),
    run,
  ];
  const pipelineRuns = currentRuns.filter(
    (timeline) => timeline.pipeline === run!.pipeline,
  );
  return {
    country,
    now_ms: nowMs,
    run,
    forecast: forecastCompletion(run, currentRuns, nowMs),
    pipeline_runs: pipelineRuns.length,
    stage_stats: stageStatistics(
      pipelineRuns.filter((timeline) => timeline.state !== "running"),
    ),
    gate_stats: gateStatistics(pipelineRuns),
    failure_classes: failureClassStatistics(pipelineRuns),
    phase_totals: pipelineRuns.map((timeline) => phaseTotals(timeline, nowMs)),
    gate_catalog: gateCatalogForPipeline(run.pipeline),
  };
}
