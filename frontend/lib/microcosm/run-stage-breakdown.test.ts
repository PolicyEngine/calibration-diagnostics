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

function stat(
  stage: string,
  typicalMinutes: number | null,
  p90Minutes: number | null,
  finishedRuns = 5,
): StageStat {
  return {
    stage,
    samples: finishedRuns,
    cut_short: 0,
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

test("a stage still running, or stopped early, is compared with typical only once it has run past it", () => {
  const stats = [stat("load_inputs", 8, 9), stat("calibrate", 240, 300)];
  const running = (now: string) =>
    runStageBreakdown(
      run("running", "10:00", null, [
        { stage: "load_inputs", phase: "setup", start: "10:00", end: "10:10" },
        { stage: "calibrate", phase: "calibrate", start: "10:10", end: null },
      ]),
      stats,
      at(now),
    ).stages.find((stage) => stage.stage === "calibrate")!;

  // 30 minutes into a stage that typically takes 4 hours says nothing yet.
  expect(running("10:40").over_typical_ms).toBeNull();
  // Past the typical time, the overrun counts.
  expect(running("14:20").over_typical_ms).toBe(10 * MINUTE);

  const failedEarly = runStageBreakdown(
    run("failed", "10:00", "10:05", [
      { stage: "calibrate", phase: "calibrate", start: "10:00", end: "10:05", status: "failed" },
    ]),
    [stat("calibrate", 30, 40)],
    at("12:00"),
  ).stages[0];
  expect(failedEarly.over_typical_ms).toBeNull();
  expect(failedEarly.past_p90).toBe(false);
});

test("a stage is marked past the 90th percentile only beyond about typical, and with three finished runs", () => {
  const single = (minutes: number, typical: number, p90: number, finishedRuns: number) =>
    runStageBreakdown(
      run("passed", "10:00", "13:00", [
        {
          stage: "calibrate",
          phase: "calibrate",
          start: "10:00",
          end: `${String(10 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
        },
      ]),
      [stat("calibrate", typical, p90, finishedRuns)],
      at("14:00"),
    ).stages[0];

  // 31 minutes against a 30.5-minute median and a 30.9-minute 90th percentile.
  const close = single(31, 30.5, 30.9, 5);
  expect([close.about_typical, close.past_p90]).toEqual([true, false]);
  const slow = single(60, 30, 40, 5);
  expect([slow.about_typical, slow.past_p90, slow.typical_runs]).toEqual([false, true, 5]);
  // Two finished runs, this one included, are too few for a 90th percentile.
  const fewRuns = single(60, 30, 40, 2);
  expect([fewRuns.past_p90, fewRuns.typical_runs]).toEqual([false, 2]);
});

test("a stage that went silent is compared only past typical, and a stage just past typical reads as about typical", () => {
  // A stalled run's last stage went silent after 20 minutes of a 30-minute
  // typical: not comparable yet.
  const silent = runStageBreakdown(
    {
      ...run("stalled", "10:00", null, [
        { stage: "calibrate", phase: "calibrate", start: "10:00", end: "10:20" },
      ]),
      updated_ms: at("10:20"),
    } as BuildTimeline,
    [stat("calibrate", 30, 40)],
    at("12:00"),
  ).stages[0];
  expect([silent.status, silent.over_typical_ms, silent.past_p90]).toEqual(["silent", null, false]);

  // Ten minutes past a 4-hour typical is within 5% of it.
  const justPast = runStageBreakdown(
    run("running", "10:00", null, [{ stage: "calibrate", phase: "calibrate", start: "10:00", end: null }]),
    [stat("calibrate", 240, 300)],
    at("14:10"),
  ).stages[0];
  expect([justPast.over_typical_ms, justPast.about_typical, justPast.past_p90]).toEqual([10 * MINUTE, true, false]);
});
