import {
  type BuildPhase,
  type BuildTimeline,
  type StageStat,
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

export function runStageBreakdown(
  _run: BuildTimeline,
  _stageStats: readonly StageStat[],
  _nowMs: number,
): RunStageBreakdown {
  return { total_ms: null, between_stages_ms: 0, stages: [] };
}
