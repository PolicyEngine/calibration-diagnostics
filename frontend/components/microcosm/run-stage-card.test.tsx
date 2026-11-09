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
  {
    stage: "load_inputs",
    samples: 2,
    cut_short: 0,
    finished_median_ms: 8 * MINUTE,
    finished_p90_ms: 9 * MINUTE,
    finished_max_ms: 9 * MINUTE,
  },
  {
    stage: "calibrate",
    samples: 5,
    cut_short: 0,
    finished_median_ms: 30 * MINUTE,
    finished_p90_ms: 40 * MINUTE,
    finished_max_ms: 55 * MINUTE,
  },
  {
    stage: "export",
    samples: 1,
    cut_short: 1,
    finished_median_ms: null,
    finished_p90_ms: null,
    finished_max_ms: null,
  },
] as StageStat[];

// Each table row's cells, empty ones included, as text.
function cells(markup: string): string[][] {
  return [...markup.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map((cell) =>
      cell[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    ),
  );
}

function card(): string {
  return renderToStaticMarkup(
    createElement(RunStageCard, { run: RUN, stageStats: STATS, nowMs: at("12:00"), pipelineLabel: "US release build" }),
  );
}

test("the This run card lists each stage slowest first with its time, share, and the p50, p90 and longest time", () => {
  const markup = card();

  expect(markup).toContain("This run by stage");
  expect(cells(markup)).toEqual([
    ["Stage", "This run", "Share", "p50", "p90", "Max", "Against p50"],
    ["Calibrate", "", "1 h", "75%", "30 min", "40 min", "55 min", "+30 min (2.0×) past the 90th percentile"],
    // Two runs only: too few for a 90th percentile.
    ["Load inputs", "", "10 min", "13%", "8 min · 2 runs", "—", "9 min", "+2 min"],
    ["Export", "", "5 min", "6%", "—", "—", "—", "—"],
    ["Between stages", "", "5 min", "6%", "", "", "", ""],
  ]);
});

// The bar and the time sit in cells of their own, so the table gives every
// time the width of the longest and every bar the same width: bars of equal
// length mean equal times.
test("each stage's bar has a cell of its own, apart from its time, with one width for every bar", () => {
  const markup = card();

  const barCells = [...markup.matchAll(/<td class="([^"]*)"><span class="relative h-2/g)].map((match) => match[1]);
  expect(barCells).toHaveLength(3);
  expect(new Set(barCells).size).toBe(1);
  // The cell after each bar holds the stage's time, on one line.
  const timeCells = [...markup.matchAll(/<span class="relative h-2[\s\S]*?<\/td><td class="([^"]*)"/g)].map(
    (match) => match[1],
  );
  expect(timeCells).toHaveLength(3);
  for (const timeCell of timeCells) expect(timeCell).toContain("whitespace-nowrap");
});
