import { expect, test } from "bun:test";

import type { BuildPhase, BuildTimeline, StageStat } from "@/lib/microcosm/build-monitor";
import { runStageBreakdown } from "@/lib/microcosm/run-stage-breakdown";

const at = (clock: string) => Date.parse(`2026-11-03T${clock}:00Z`);
const MINUTE = 60_000;

interface SpanSpec {
  stage: string;
  phase: BuildPhase;
  start: string;
  end: string | null;
  status?: "running" | "completed" | "failed";
}

// Only the fields the breakdown reads.
function run(
  state: BuildTimeline["state"],
  started: string,
  ended: string | null,
  spans: SpanSpec[],
): BuildTimeline {
  return {
    run_id: "run",
    state,
    started_ms: at(started),
    ended_ms: ended ? at(ended) : null,
    updated_ms: ended ? at(ended) : null,
    spans: spans.map((span) => ({
      stage: span.stage,
      phase: span.phase,
      depth: 0,
      start_ms: at(span.start),
      end_ms: span.end ? at(span.end) : null,
      status: span.status ?? (span.end ? "completed" : "running"),
      is_gate: false,
    })),
  } as unknown as BuildTimeline;
}

function stat(stage: string, typicalMinutes: number | null, p90Minutes: number | null): StageStat {
  return {
    stage,
    finished_median_ms: typicalMinutes == null ? null : typicalMinutes * MINUTE,
    finished_p90_ms: p90Minutes == null ? null : p90Minutes * MINUTE,
  } as StageStat;
}

// 80 minutes from start to end: 10 in inputs, 60 in calibration, 5 in
// export, and 5 between stages.
const FINISHED = run("passed", "10:00", "11:20", [
  { stage: "load_inputs", phase: "setup", start: "10:00", end: "10:10" },
  { stage: "calibrate", phase: "calibrate", start: "10:12", end: "11:12" },
  { stage: "export", phase: "export", start: "11:12", end: "11:17" },
]);
const STATS = [stat("load_inputs", 8, 9), stat("calibrate", 30, 40), stat("export", null, null)];

test("a run's stages are listed slowest first with their share of the run", () => {
  const breakdown = runStageBreakdown(FINISHED, STATS, at("12:00"));

  expect(breakdown.total_ms).toBe(80 * MINUTE);
  expect(breakdown.between_stages_ms).toBe(5 * MINUTE);
  expect(breakdown.stages.map((stage) => [stage.stage, stage.ms / MINUTE, stage.share])).toEqual([
    ["calibrate", 60, 0.75],
    ["load_inputs", 10, 0.125],
    ["export", 5, 0.0625],
  ]);
});

test("each stage sits beside the pipeline's typical time and how far it ran over it", () => {
  const breakdown = runStageBreakdown(FINISHED, STATS, at("12:00"));

  expect(
    breakdown.stages.map((stage) => [
      stage.stage,
      stage.typical_ms == null ? null : stage.typical_ms / MINUTE,
      stage.typical_p90_ms == null ? null : stage.typical_p90_ms / MINUTE,
      stage.over_typical_ms == null ? null : stage.over_typical_ms / MINUTE,
    ]),
  ).toEqual([
    ["calibrate", 30, 40, 30],
    ["load_inputs", 8, 9, 2],
    // No run has finished export yet, so there is no typical time.
    ["export", null, null, null],
  ]);
});

test("a stage run twice counts once, with both attempts' time", () => {
  const retried = run("passed", "10:00", "11:00", [
    { stage: "calibrate", phase: "calibrate", start: "10:00", end: "10:20", status: "failed" },
    { stage: "calibrate", phase: "calibrate", start: "10:20", end: "10:50" },
    { stage: "export", phase: "export", start: "10:50", end: "11:00" },
  ]);

  const breakdown = runStageBreakdown(retried, [], at("12:00"));

  expect(breakdown.stages.map((stage) => [stage.stage, stage.ms / MINUTE, stage.status])).toEqual([
    ["calibrate", 50, "failed"],
    ["export", 10, "completed"],
  ]);
  expect(breakdown.between_stages_ms).toBe(0);
});

test("a running run counts its open stage's time so far, against the time so far", () => {
  const running = run("running", "10:00", null, [
    { stage: "load_inputs", phase: "setup", start: "10:00", end: "10:10" },
    { stage: "calibrate", phase: "calibrate", start: "10:10", end: null },
  ]);

  const breakdown = runStageBreakdown(running, STATS, at("10:40"));

  expect(breakdown.total_ms).toBe(40 * MINUTE);
  expect(breakdown.stages.map((stage) => [stage.stage, stage.ms / MINUTE, stage.status, stage.share])).toEqual([
    ["calibrate", 30, "running", 0.75],
    ["load_inputs", 10, "completed", 0.25],
  ]);
});
