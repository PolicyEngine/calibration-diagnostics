import {
  type BuildPhase,
  type BuildTimeline,
  type StageStat,
  runDurationMs,
  spanDurationMs,
} from "@/lib/microcosm/build-monitor";

// What one run did in each of its top-level stages: how long it spent there
// and how the stage ended for it.
export type RunStageStatus = "completed" | "running" | "failed" | "silent";

export interface RunStage {
  ms: number;
  status: RunStageStatus;
}

// Each top-level stage of `run`, with its time summed over every attempt.
export function runStageTimes(run: BuildTimeline, nowMs: number): Map<string, RunStage> {
  const top = run.spans.filter((span) => span.depth === 0);
  const last = top[top.length - 1];
  const stages = new Map<string, RunStage>();
  for (const span of top) {
    const status: RunStageStatus =
      span.end_ms == null
        ? "running"
        : span.status === "failed"
          ? "failed"
          : run.state === "stalled" && span === last
            ? "silent"
            : "completed";
    const previous = stages.get(span.stage);
    stages.set(span.stage, {
      ms: (previous?.ms ?? 0) + spanDurationMs(span, nowMs),
      status: previous?.status === "failed" ? "failed" : status,
    });
  }
  return stages;
}

export interface RunStageTime {
  stage: string;
  phase: BuildPhase;
  ms: number;
  status: RunStageStatus;
  // The stage's time over the run's elapsed time; null when that is unknown.
  share: number | null;
  // The pipeline's median and p90 for runs that finished the stage.
  typical_ms: number | null;
  typical_p90_ms: number | null;
  // This run's time minus the typical time.
  over_typical_ms: number | null;
}

export interface RunStageBreakdown {
  // The run's elapsed time: to its end, its last telemetry if it stalled, or now.
  total_ms: number | null;
  // Elapsed time spent in no top-level stage.
  between_stages_ms: number;
  // Slowest first.
  stages: RunStageTime[];
}

// The selected run's runtime by top-level stage, slowest first, each beside
// the pipeline's typical time for it. `stageStats` are the statistics of the
// pipeline's runs with the same stage sequence, this run included.
export function runStageBreakdown(
  run: BuildTimeline,
  stageStats: readonly StageStat[],
  nowMs: number,
): RunStageBreakdown {
  const times = runStageTimes(run, nowMs);
  const statByStage = new Map(stageStats.map((stat) => [stat.stage, stat]));
  const phaseByStage = new Map<string, BuildPhase>();
  for (const span of run.spans) {
    if (span.depth === 0 && !phaseByStage.has(span.stage)) phaseByStage.set(span.stage, span.phase);
  }
  const total = runDurationMs(run, nowMs);
  const inStages = [...times.values()].reduce((sum, time) => sum + time.ms, 0);
  const stages = [...times].map(([stage, time], firstSeen) => {
    const stat = statByStage.get(stage);
    const typical = stat?.finished_median_ms ?? null;
    return {
      firstSeen,
      stage,
      phase: phaseByStage.get(stage)!,
      ms: time.ms,
      status: time.status,
      share: total ? time.ms / total : null,
      typical_ms: typical,
      typical_p90_ms: stat?.finished_p90_ms ?? null,
      over_typical_ms: typical == null ? null : time.ms - typical,
    };
  });
  stages.sort((first, second) => second.ms - first.ms || first.firstSeen - second.firstSeen);
  return {
    total_ms: total,
    between_stages_ms: total == null ? 0 : Math.max(0, total - inStages),
    stages: stages.map(({ firstSeen: _firstSeen, ...stage }) => stage),
  };
}
