import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BUILD_PHASES, type BuildForecast, type BuildTimeline } from "@/lib/microcosm/build-monitor";
import { NO_FOCUS, type TimelineFocus } from "@/lib/microcosm/timeline-focus";
import { PHASE_COLOR, TimelineView } from "./build-monitor-view";

const at = (minute: number) => Date.parse("2026-11-03T10:00:00Z") + minute * 60_000;

// 80 minutes: 10 loading inputs, 60 calibrating, 5 exporting.
const STAGES = [
  ["load_inputs", "setup", 0, 10],
  ["calibrate", "calibrate", 12, 72],
  ["export_dataset", "export", 72, 77],
] as const;

const RUN = {
  run_id: "run",
  state: "passed",
  started_ms: at(0),
  ended_ms: at(80),
  updated_ms: at(80),
  solver_passes: [],
  spans: STAGES.map(([stage, phase, start, end]) => ({
    stage,
    phase,
    depth: 0,
    start_ms: at(start),
    end_ms: at(end),
    status: "completed",
    is_gate: false,
  })),
} as unknown as BuildTimeline;

const FORECAST = {
  elapsed_ms: 80 * 60_000,
  finish_p50_ms: null,
  finish_p90_ms: null,
  stages: STAGES.map(([stage, phase, start, end]) => ({
    stage,
    phase,
    status: "done",
    basis: "observed",
    start_offset_ms: start * 60_000,
    end_offset_ms: end * 60_000,
  })),
} as unknown as BuildForecast;

function timeline(expanded: boolean, focus: Partial<TimelineFocus> = {}): string {
  return renderToStaticMarkup(
    createElement(TimelineView, {
      run: RUN,
      forecast: FORECAST,
      nowMs: at(90),
      expanded,
      focus: { ...NO_FOCUS, ...focus },
      onToggleExpanded: () => {},
      onHoverPhase: () => {},
      onTogglePhase: () => {},
      onToggleStage: () => {},
      onHoverStage: () => {},
    }),
  );
}

// The style of the Whole run segment whose hover text starts with `label`.
function wholeRunSegmentStyle(markup: string, label: string): string | null {
  const match = markup.match(new RegExp(`<div class="[^"]*" style="([^"]*)" title="${label}: `));
  return match ? match[1] : null;
}

test("the Timeline opens collapsed to the Whole run bar and the stage-type labels, with no description", () => {
  const markup = timeline(false);

  expect(markup).toContain(">Whole run<");
  expect(markup).toContain('aria-expanded="false"');
  // No per-stage breakdown rows.
  expect(markup).not.toContain(">Load inputs</");
  expect(markup).not.toContain(">Calibrate</");
  for (const phase of BUILD_PHASES) {
    expect(markup).toMatch(new RegExp(`<button[^>]*aria-pressed="false"[^>]*>(?:<[^>]+>)*[^<]*${phase.label.replace("&", "&amp;")}`));
  }
  expect(markup).not.toContain("on one time axis");
  expect(markup).not.toContain("faint bars");
});

test("the caret opens the per-stage breakdown", () => {
  const markup = timeline(true);

  expect(markup).toContain('aria-expanded="true"');
  expect(markup).toContain(">Load inputs</");
  expect(markup).toContain(">Calibrate</");
});

test("picked stage types are all Whole run shows, and it is renamed Whole run (filtered)", () => {
  const markup = timeline(false, { filter: new Set(["calibrate", "export"]) });

  expect(markup).toContain(">Whole run (filtered)<");
  expect(wholeRunSegmentStyle(markup, "Calibrate")).not.toBeNull();
  expect(wholeRunSegmentStyle(markup, "Export dataset")).not.toBeNull();
  // Hidden types shrink to no width, so the change can be animated.
  expect(wholeRunSegmentStyle(markup, "Load inputs")).toContain("width:0%");
  expect(markup).toMatch(/<button[^>]*aria-pressed="true"[^>]*>(?:<[^>]+>)*[^<]*Calibration/);
});

test("hovering a stage type shows its total time and dims the other types", () => {
  const markup = timeline(false, { hoveredPhase: "calibrate" });

  expect(markup).toMatch(/role="tooltip"[^>]*>(?:<[^>]+>)*Calibration(?:<[^>]+>)*\s*(?:<[^>]+>)*1 h</);
  // The hover card describes the label it belongs to.
  const describedBy = markup.match(/<button[^>]*aria-describedby="([^"]+)"[^>]*>(?:<[^>]+>)*[^<]*Calibration/)?.[1];
  expect(describedBy).toBeTruthy();
  expect(markup).toContain(`id="${describedBy}" role="tooltip"`);
  expect(wholeRunSegmentStyle(markup, "Calibrate")).toContain("opacity:1");
  expect(wholeRunSegmentStyle(markup, "Load inputs")).toContain("opacity:0.25");
});

test("a clicked stage stays at full strength in Whole run and the others are dimmed", () => {
  const markup = timeline(true, { selectedStage: "calibrate-1" });

  expect(wholeRunSegmentStyle(markup, "Calibrate")).toContain("opacity:1");
  expect(wholeRunSegmentStyle(markup, "Load inputs")).toContain("opacity:0.25");
  expect(wholeRunSegmentStyle(markup, "Export dataset")).toContain("opacity:0.25");
  expect(markup).toMatch(/<button[^>]*aria-pressed="true"[^>]*>(?:<[^>]+>)*Calibrate</);
});

test("each stage type has a colour of its own from the theme's stage-type tokens", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const colours = BUILD_PHASES.map((phase) => {
    expect(PHASE_COLOR[phase.id]).toBe(`var(--phase-${phase.id})`);
    return css.match(new RegExp(`--phase-${phase.id}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
  });
  expect(colours.every(Boolean)).toBe(true);
  expect(new Set(colours).size).toBe(BUILD_PHASES.length);
});

// The labels of the stage-type buttons, in the order they appear.
function legendLabels(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map((match) =>
    match[1].replace(/&amp;/g, "&"),
  );
}

// A Whole run segment's left edge and width, in percent of the bar.
function segmentPlace(markup: string, label: string): { left: number; width: number } {
  const style = wholeRunSegmentStyle(markup, label) ?? "";
  return {
    left: Number(style.match(/left:([\d.]+)%/)?.[1]),
    width: Number(style.match(/width:([\d.]+)%/)?.[1]),
  };
}

test("the stage types are listed in the order the build first reached them", () => {
  expect(legendLabels(timeline(false))).toEqual([
    "Setup & inputs",
    "Calibration",
    "Export & diagnostics",
    "Checks & gates",
    "Target compilation",
  ]);
});

test("with types picked, the breakdown shows only their stages, and they fill the Whole run bar", () => {
  const one = timeline(true, { filter: new Set(["calibrate"]) });
  expect(one).toContain(">Calibrate</");
  expect(one).not.toContain(">Load inputs</");
  expect(one).not.toContain(">Export dataset</");
  expect(segmentPlace(one, "Calibrate")).toEqual({ left: 0, width: 100 });

  // 60 minutes of calibration and 5 of export, laid end to end.
  const two = timeline(true, { filter: new Set(["calibrate", "export"]) });
  const calibrate = segmentPlace(two, "Calibrate");
  const exported = segmentPlace(two, "Export dataset");
  expect(calibrate.left).toBe(0);
  expect(calibrate.width).toBeCloseTo((60 / 65) * 100, 6);
  expect(exported.left).toBeCloseTo(calibrate.width, 6);
  expect(calibrate.width + exported.width).toBeCloseTo(100, 6);
});

test("a stage's name has no hover text with its code name", () => {
  const markup = timeline(true);
  for (const code of ["load_inputs", "calibrate", "export_dataset"]) {
    expect(markup).not.toContain(`title="${code}"`);
  }
});

test("hovering a stage in the breakdown highlights it in Whole run and dims the others", () => {
  const markup = timeline(true, { hoveredStage: "calibrate-1" });

  expect(wholeRunSegmentStyle(markup, "Calibrate")).toContain("opacity:1");
  expect(wholeRunSegmentStyle(markup, "Load inputs")).toContain("opacity:0.25");
});

test("Whole run segments move and resize over 0.2 seconds, unless the viewer asks for less motion", () => {
  const markup = timeline(false, { filter: new Set(["calibrate"]) });
  const classes = [...markup.matchAll(/<div class="([^"]*)" style="[^"]*" title="(?:Load inputs|Calibrate|Export dataset): /g)].map(
    (match) => match[1],
  );

  expect(classes).toHaveLength(3);
  for (const segmentClass of classes) {
    expect(segmentClass).toContain("transition-[left,width,opacity]");
    expect(segmentClass).toContain("duration-200");
    expect(segmentClass).toContain("motion-reduce:transition-none");
  }
});
