import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BuildTimeline, StageStat } from "@/lib/microcosm/build-monitor";
import { RunStageCard } from "./build-monitor-view";

const at = (clock: string) => Date.parse(`2026-11-03T${clock}:00Z`);
const MINUTE = 60_000;

// 80 minutes: 10 loading inputs, 60 calibrating, 5 exporting, 5 between.
const RUN = {
  run_id: "run",
  state: "passed",
  started_ms: at("10:00"),
  ended_ms: at("11:20"),
  updated_ms: at("11:20"),
  spans: [
    ["load_inputs", "setup", "10:00", "10:10"],
    ["calibrate", "calibrate", "10:12", "11:12"],
    ["export", "export", "11:12", "11:17"],
  ].map(([stage, phase, start, end]) => ({
    stage,
    phase,
    depth: 0,
    start_ms: at(start),
    end_ms: at(end),
    status: "completed",
    is_gate: false,
  })),
} as unknown as BuildTimeline;

// Five runs finished calibration, two the inputs stage, none export.
const STATS = [
  { stage: "load_inputs", samples: 2, cut_short: 0, finished_median_ms: 8 * MINUTE, finished_p90_ms: 9 * MINUTE },
  { stage: "calibrate", samples: 5, cut_short: 0, finished_median_ms: 30 * MINUTE, finished_p90_ms: 40 * MINUTE },
  { stage: "export", samples: 1, cut_short: 1, finished_median_ms: null, finished_p90_ms: null },
] as StageStat[];

function rows(markup: string): string[] {
  return [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((match) =>
    match[1]
      .replace(/<[^>]+>/g, "|")
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(" | "),
  );
}

test("the This run card lists each stage slowest first with its time, share and typical time", () => {
  const markup = renderToStaticMarkup(
    createElement(RunStageCard, { run: RUN, stageStats: STATS, nowMs: at("12:00"), pipelineLabel: "US release build" }),
  );

  expect(markup).toContain("This run by stage");
  expect(rows(markup)).toEqual([
    "Stage | This run | Share | Typical | Against typical",
    "Calibrate | 1 h | 75% | 30 min | +30 min (2.0×) | past the 90th percentile",
    // Typical from two runs only: too few to mark a 90th percentile.
    "Load inputs | 10 min | 13% | 8 min · 2 runs | +2 min",
    "Export | 5 min | 6% | — | —",
    "Between stages | 5 min | 6%",
  ]);
});
