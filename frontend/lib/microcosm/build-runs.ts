import {
  type BuildForecast,
  type BuildRunDocuments,
  type BuildRunSource,
  type BuildTimeline,
  type GateStat,
  type PhaseTotals,
  type StageStat,
  buildTimeline,
  collectorMissedTheEnd,
  compactTimeline,
  keepListedUploads,
  type StopStat,
  stopStatistics,
  forecastCompletion,
  gateStatistics,
  phaseTotals,
  sameStageSequence,
  stageStatistics,
  withHuggingFaceUploads,
} from "@/lib/microcosm/build-monitor";
import {
  type CatalogGate,
  gateCatalogForPipeline,
} from "@/lib/microcosm/build-gate-catalog";
import {
  hasCapability,
  type MicrocosmCountry,
} from "@policyengine/calibration-tree/countries";
import {
  discoverLocalRuns,
  loadLocalRunDocuments,
  localRunCountry,
  localRunRoots,
} from "@/lib/microcosm/local-build-runs";
import {
  loadStagingRuns,
  loadStagingRunTelemetry,
} from "@policyengine/calibration-tree/staging-artifact";
import {
  type CollectorRunSummary,
  collectorConfigured,
  loadCollectorRun,
  loadCollectorRuns,
} from "@/lib/server/microcosm/telemetry-collector-client";

// Server-side assembly for the build monitor: load every run's telemetry from
// one source, turn it into timelines, and derive the forecast and cross-run
// statistics for the selected run's pipeline.

const STAGING_LIST_TTL_MS = 30_000;
const STAGING_RUN_LIMIT = 60;
// How long one answer to the collector's run list serves the Staging routes
// on a server instance. The Candidate tab's two routes poll together every 30
// seconds, as does the Build progress list. On Vercel, `staging/run` (whose
// `maxDuration` is 300) runs in a different function from `builds`,
// `builds/run` and `staging/runs` (120), so it keeps its own cache, and a poll
// makes one list request per country in each of the two functions. Each run's
// own record is read as before.
const COLLECTOR_LIST_TTL_MS = 15_000;
// How long the Candidate tab waits for the collector's run list. Past it, the
// tab uses the list's latest earlier answer, or shows the Hugging Face states
// when there is none. The request carries on while the server instance runs,
// and its answer serves the next poll, but a later call does not share it.
const COLLECTOR_LIST_WAIT_MS = 5_000;
// How old that earlier answer may be: two of the Candidate tab's 30-second
// polls. A list that answers after the wait is more than 15 seconds old at the
// next poll, and that poll's own request may be as slow.
const EARLIER_COLLECTOR_LIST_MAX_AGE_MS = 60_000;

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
  // Runs of the same pipeline left out of the statistics and forecast
  // because they went through a different stage sequence.
  other_sequence_runs: number;
  stage_stats: StageStat[];
  gate_stats: GateStat[];
  stop_stats: StopStat[];
  phase_totals: PhaseTotals[];
  gate_catalog: CatalogGate[] | null;
}

interface CachedRun {
  documents: BuildRunDocuments;
  final: boolean;
  collector_version: string | null;
}

// Finished staging runs never change, so their telemetry is fetched once.
const stagingRunCache = new Map<string, CachedRun>();
const stagingListCache = new Map<
  string,
  { expiresAt: number; promise: Promise<LoadedRuns> }
>();

// The country's 60 most recent collector runs, shared by every caller: a list
// that answered is reused for `COLLECTOR_LIST_TTL_MS` after it answered, a
// request in flight is shared for `COLLECTOR_LIST_WAIT_MS` after it was made,
// and a failed request is dropped so the next caller asks again.
//
// An older request in flight may have no caller left: the Candidate tab stops
// waiting after `COLLECTOR_LIST_WAIT_MS`, and nothing keeps the request running
// after the response, so Vercel can suspend the instance with it in flight. A
// later caller that shared it would receive its overdue timeout error, so a
// later caller makes a new request instead.
const collectorLists = new Map<
  MicrocosmCountry,
  {
    runs: Promise<CollectorRunSummary[]>;
    requestedAt: number;
    answeredAt: number | null;
  }
>();
// The list of the latest request that answered for each country, kept while
// a newer request is in flight.
const answeredCollectorLists = new Map<
  MicrocosmCountry,
  { runs: CollectorRunSummary[]; requestedAt: number; answeredAt: number }
>();
// Counts `clear()` calls, so that a request made before one keeps no answer.
let collectorListsGeneration = 0;

export const collectorRunLists = {
  recent(country: MicrocosmCountry): Promise<CollectorRunSummary[]> {
    const now = Date.now();
    const cached = collectorLists.get(country);
    if (
      cached &&
      (cached.answeredAt == null
        ? now - cached.requestedAt < COLLECTOR_LIST_WAIT_MS
        : now - cached.answeredAt < COLLECTOR_LIST_TTL_MS)
    ) {
      return cached.runs;
    }
    const generation = collectorListsGeneration;
    const entry = {
      runs: loadCollectorRuns(country, STAGING_RUN_LIMIT),
      requestedAt: now,
      answeredAt: null as number | null,
    };
    collectorLists.set(country, entry);
    entry.runs.then(
      (runs) => {
        entry.answeredAt = Date.now();
        // An answer to a request a newer one replaced still counts, unless
        // `clear()` ran since or a newer request has already answered.
        const latest = answeredCollectorLists.get(country);
        if (
          generation === collectorListsGeneration &&
          (!latest || latest.requestedAt <= entry.requestedAt)
        ) {
          answeredCollectorLists.set(country, {
            runs,
            requestedAt: entry.requestedAt,
            answeredAt: entry.answeredAt,
          });
        }
      },
      () => {
        if (collectorLists.get(country) === entry) collectorLists.delete(country);
      },
    );
    return entry.runs;
  },
  // The latest list that answered less than `maxAgeMs` ago, or null.
  answeredWithin(
    country: MicrocosmCountry,
    maxAgeMs: number,
  ): CollectorRunSummary[] | null {
    const answered = answeredCollectorLists.get(country);
    return answered && Date.now() - answered.answeredAt < maxAgeMs
      ? answered.runs
      : null;
  },
  clear(): void {
    collectorListsGeneration += 1;
    collectorLists.clear();
    answeredCollectorLists.clear();
  },
};

const WAIT_OVER = Symbol("wait over");

// `promise`'s value, or `WAIT_OVER` when it has not settled within `waitMs`.
// A rejection within the wait is thrown.
async function settledWithin<T>(
  promise: Promise<T>,
  waitMs: number,
): Promise<T | typeof WAIT_OVER> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waitOver = new Promise<typeof WAIT_OVER>((resolve) => {
    timer = setTimeout(() => resolve(WAIT_OVER), waitMs);
  });
  try {
    return await Promise.race([promise, waitOver]);
  } finally {
    clearTimeout(timer);
  }
}

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
    source: "staging",
    country,
  }),
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A run in one of these statuses has ended and its telemetry no longer changes.
const FINAL_STATUSES = new Set(["passed", "completed", "blocked", "failed"]);

function isFinal(documents: BuildRunDocuments): boolean {
  const status = documents.progress?.status ?? documents.run_manifest?.status;
  return typeof status === "string" && FINAL_STATUSES.has(status);
}

async function loadLocal(country: MicrocosmCountry): Promise<LoadedRuns> {
  const roots = localRunRoots();
  if (!roots.length) {
    return {
      available: false,
      detail:
        "Local runs are off. Set MICROCOSM_LOCAL_RUNS_DIR to the folder your builds write to.",
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
    list.runs.slice(0, STAGING_RUN_LIMIT).map(async (summary) => {
      const key = `${country}:${summary.run_id}`;
      const cached = stagingRunCache.get(key);
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
          source: "staging",
          country,
        };
        stagingRunCache.set(key, {
          documents: loaded,
          final: isFinal(loaded),
          collector_version: null,
        });
        documents.push(loaded);
      } catch (error) {
        problems.push({ run_id: summary.run_id, detail: message(error) });
      }
    }),
  );
  return { available: true, detail: null, documents, problems };
}

// One collector run's documents. A finished run's documents are reused until
// the collector reports a newer update for it.
async function loadCollectorDocuments(
  summary: CollectorRunSummary,
  country: MicrocosmCountry,
): Promise<BuildRunDocuments> {
  const key = `collector:${country}:${summary.run_id}`;
  const cached = stagingRunCache.get(key);
  if (
    cached?.final &&
    FINAL_STATUSES.has(summary.status) &&
    cached.collector_version === summary.updated_at
  ) {
    return cached.documents;
  }
  const loaded = await loadCollectorRun(summary.run_id, country);
  stagingRunCache.set(key, {
    documents: loaded,
    final: isFinal(loaded),
    collector_version: summary.updated_at,
  });
  return loaded;
}

async function loadCollector(country: MicrocosmCountry): Promise<LoadedRuns> {
  const summaries = await collectorRunLists.recent(country);
  const documents: BuildRunDocuments[] = [];
  const problems: BuildRunProblem[] = [];
  await Promise.all(
    summaries.map(async (summary) => {
      try {
        documents.push(await loadCollectorDocuments(summary, country));
      } catch (error) {
        problems.push({ run_id: summary.run_id, detail: message(error) });
      }
    }),
  );
  return { available: true, detail: null, documents, problems };
}

export interface CollectorTimelines {
  // The build monitor's timeline of each requested run the collector has a
  // record of, by run id.
  timelines: Map<string, BuildTimeline>;
  // Why some or all requested runs could not use the collector's record;
  // null when the collector answered for every run it knows.
  note: string | null;
}

const HUGGING_FACE_FALLBACK =
  "run states come from the Hugging Face staging repository";

// The collector's state for runs the Candidate tab lists from Hugging Face.
// It reads the same records the Build progress tab does (the country's 60
// most recent collector runs, from the shared list) and derives each state
// with the same `buildTimeline`, so the two tabs agree on every run the
// collector knows. It waits at most `waitMs` for the list.
export async function loadCollectorTimelines(
  country: MicrocosmCountry,
  runIds: readonly string[],
  nowMs: number = Date.now(),
  waitMs: number = COLLECTOR_LIST_WAIT_MS,
): Promise<CollectorTimelines> {
  const timelines = new Map<string, BuildTimeline>();
  if (!runIds.length) return { timelines, note: null };
  let summaries: CollectorRunSummary[];
  try {
    // An invalid collector setting throws here; it must not hide the
    // Hugging Face runs.
    if (!collectorConfigured()) {
      return {
        timelines,
        note: `The telemetry collector is not configured on this server, so ${HUGGING_FACE_FALLBACK}.`,
      };
    }
    const listed = await settledWithin(collectorRunLists.recent(country), waitMs);
    if (listed !== WAIT_OVER) {
      summaries = listed;
    } else {
      // The request carries on, and its answer serves a later poll. Until it
      // answers, an earlier answer that is recent enough stands in.
      const earlier = collectorRunLists.answeredWithin(
        country,
        EARLIER_COLLECTOR_LIST_MAX_AGE_MS,
      );
      if (!earlier) {
        return {
          timelines,
          note: `The telemetry collector did not answer within ${waitMs / 1000} seconds, so ${HUGGING_FACE_FALLBACK}.`,
        };
      }
      summaries = earlier;
    }
  } catch (error) {
    return {
      timelines,
      note: `The telemetry collector could not be read (${message(error)}), so ${HUGGING_FACE_FALLBACK}.`,
    };
  }
  const requested = new Set(runIds);
  const problems: BuildRunProblem[] = [];
  await Promise.all(
    summaries
      .filter((summary) => requested.has(summary.run_id))
      .map(async (summary) => {
        try {
          const documents = await loadCollectorDocuments(summary, country);
          timelines.set(summary.run_id, buildTimeline(documents, nowMs));
        } catch (error) {
          problems.push({ run_id: summary.run_id, detail: message(error) });
        }
      }),
  );
  if (!problems.length) return { timelines, note: null };
  const unreadable = problems
    .map((problem) => `${problem.run_id} (${problem.detail})`)
    .join(", ");
  return {
    timelines,
    note: `The telemetry collector's record could not be read for ${unreadable}, so ${
      problems.length === 1 ? "that run's state comes" : "those runs' states come"
    } from the Hugging Face staging repository.`,
  };
}

// The hosted documents the build monitor shows, one per run id. During the
// migration period a collector record replaces the run's historical Hugging
// Face copy, unless the record stopped before an end the copy recorded later
// (`collectorMissedTheEnd`, the rule the Candidate tab uses too). A record
// that replaces a copy keeps the copy's upload record, which the collector
// cannot know.
export function mergeHostedDocuments(
  collector: readonly BuildRunDocuments[],
  huggingFace: readonly BuildRunDocuments[],
  nowMs: number,
): BuildRunDocuments[] {
  const byId = new Map<string, BuildRunDocuments>();
  for (const document of huggingFace) byId.set(document.run_id, document);
  for (const document of collector) {
    const copy = byId.get(document.run_id);
    if (
      copy &&
      collectorMissedTheEnd(
        buildTimeline(document, nowMs),
        buildTimeline(copy, nowMs),
      )
    ) {
      continue;
    }
    byId.set(
      document.run_id,
      copy ? withHuggingFaceUploads(document, copy) : document,
    );
  }
  return [...byId.values()];
}

async function loadStaging(country: MicrocosmCountry): Promise<LoadedRuns> {
  const hosted: LoadedRuns[] = [];
  const sourceProblems: BuildRunProblem[] = [];
  let collectorRunDocuments: BuildRunDocuments[] = [];
  let huggingFaceRunDocuments: BuildRunDocuments[] = [];
  if (collectorConfigured()) {
    try {
      const loaded = await loadCollector(country);
      hosted.push(loaded);
      collectorRunDocuments = loaded.documents;
    } catch (error) {
      sourceProblems.push({
        run_id: "collector",
        detail: message(error),
      });
    }
  }
  try {
    const loaded = await loadHuggingFaceStaging(country);
    hosted.push(loaded);
    huggingFaceRunDocuments = loaded.documents;
  } catch (error) {
    sourceProblems.push({
      run_id: "hugging-face-history",
      detail: message(error),
    });
  }
  const available = hosted.some((source) => source.available);
  return {
    available,
    detail: available
      ? null
      : hosted
          .map((source) => source.detail)
          .filter(Boolean)
          .join(" ") || "Hosted build telemetry is unavailable.",
    documents: mergeHostedDocuments(
      collectorRunDocuments,
      huggingFaceRunDocuments,
      Date.now(),
    ),
    problems: [
      ...hosted.flatMap((source) => source.problems),
      ...sourceProblems,
    ],
  };
}

function loadRuns(
  source: BuildRunSource,
  country: MicrocosmCountry,
): Promise<LoadedRuns> {
  if (source === "local") return loadLocal(country);
  const key = country;
  const cached = stagingListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = loadStaging(country);
  stagingListCache.set(key, {
    expiresAt: Date.now() + STAGING_LIST_TTL_MS,
    promise,
  });
  promise.catch(() => stagingListCache.delete(key));
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
  let collectorError: unknown = null;
  if (loaders.collectorConfigured()) {
    let collectorRun: BuildTimeline | null = null;
    try {
      collectorRun = buildTimeline(await loaders.loadCollector(runId, country), nowMs);
    } catch (error) {
      collectorError = error;
    }
    if (collectorRun) {
      // The list kept the Hugging Face copy when the collector's record
      // stopped before an end the copy recorded later; a fresh read of that
      // record must not hide the end either. Otherwise the fresh record wins,
      // with the uploads the list read from the copy.
      return current && collectorMissedTheEnd(collectorRun, current)
        ? current
        : keepListedUploads(collectorRun, current);
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
  // A running hosted run may be newer than the cached list. The live
  // collector's record wins when it responds, unless it stopped before an end
  // the Hugging Face copy recorded later; staged files are fallback.
  if (source === "staging")
    run = await refreshHostedRun(run, country, runId, nowMs);
  if (run == null) return null;
  const currentRuns = [
    ...all.filter((timeline) => timeline.run_id !== runId),
    run,
  ];
  const samePipeline = currentRuns.filter(
    (timeline) => timeline.pipeline === run!.pipeline,
  );
  const pipelineRuns = samePipeline.filter(
    (timeline) =>
      timeline.run_id === run!.run_id || sameStageSequence(run!, timeline),
  );
  return {
    source,
    country,
    now_ms: nowMs,
    run,
    forecast: forecastCompletion(run, currentRuns, nowMs),
    pipeline_runs: pipelineRuns.length,
    other_sequence_runs: samePipeline.length - pipelineRuns.length,
    // Running runs count with the stages they have finished; the open stage
    // has no end yet and is skipped.
    stage_stats: stageStatistics(pipelineRuns),
    gate_stats: gateStatistics(pipelineRuns),
    stop_stats: stopStatistics(pipelineRuns),
    phase_totals: pipelineRuns.map((timeline) => phaseTotals(timeline, nowMs)),
    gate_catalog: gateCatalogForPipeline(run.pipeline),
  };
}
