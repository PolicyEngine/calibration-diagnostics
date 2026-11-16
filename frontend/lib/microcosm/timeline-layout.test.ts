import { describe, expect, test } from "bun:test";

import type { BuildPhase } from "@/lib/microcosm/build-monitor";
import {
  axisIntervals,
  axisOffset,
  filteredAxis,
  phasesByFirstAppearance,
  type StageExtent,
} from "@/lib/microcosm/timeline-layout";

const MINUTE = 60_000;
const stage = (key: string, phase: BuildPhase, start: number, end: number): StageExtent => ({
  key,
  phase,
  start: start * MINUTE,
  end: end * MINUTE,
});

test("stage types are listed in the order the build first reached them, then the types it never reached", () => {
  const stages = [
    stage("gates-0", "checks", 0, 5),
    stage("load-1", "setup", 5, 10),
    stage("calibrate-2", "calibrate", 12, 72),
    stage("load-3", "setup", 72, 73),
  ];

  expect(phasesByFirstAppearance(stages)).toEqual(["checks", "setup", "calibrate", "compile", "export"]);
});

test("under a filter the picked types' stages are laid end to end, in the order they ran, and fill the axis", () => {
  const stages = [
    stage("load-0", "setup", 0, 10),
    stage("calibrate-1", "calibrate", 12, 72),
    stage("export-2", "export", 72, 77),
    stage("calibrate-3", "calibrate", 80, 90),
  ];
  const minutes = (axis: { starts: Map<string, number>; length: number }) => ({
    starts: Object.fromEntries([...axis.starts].map(([key, start]) => [key, start / MINUTE])),
    length: axis.length / MINUTE,
  });

  expect(minutes(filteredAxis(stages, new Set(["calibrate"])))).toEqual({
    starts: { "calibrate-1": 0, "calibrate-3": 60 },
    length: 70,
  });
  expect(minutes(filteredAxis(stages, new Set(["calibrate", "export"])))).toEqual({
    starts: { "calibrate-1": 0, "export-2": 60, "calibrate-3": 65 },
    length: 75,
  });
});

test("a stage the filter hides sits, with no length, where it falls between the shown stages", () => {
  const stages = [
    stage("load-0", "setup", 0, 10),
    stage("calibrate-1", "calibrate", 12, 72),
    stage("export-2", "export", 72, 77),
    stage("calibrate-3", "calibrate", 80, 90),
  ];
  const collapsed = filteredAxis(stages, new Set(["calibrate"])).collapsed;

  expect(Object.fromEntries([...collapsed].map(([key, at]) => [key, at / MINUTE]))).toEqual({
    "load-0": 0,
    "export-2": 60,
  });
});

test("a clicked stage alone fills the axis, with or without a stage-type filter", () => {
  const stages = [
    stage("load-0", "setup", 0, 10),
    stage("calibrate-1", "calibrate", 12, 72),
    stage("export-2", "export", 72, 77),
    stage("calibrate-3", "calibrate", 80, 90),
  ];
  const inMinutes = (places: Map<string, number>) =>
    Object.fromEntries([...places].map(([key, place]) => [key, place / MINUTE]));

  const alone = filteredAxis(stages, new Set(), "calibrate-3");
  expect(inMinutes(alone.starts)).toEqual({ "calibrate-3": 0 });
  expect(alone.length).toBe(10 * MINUTE);
  // The other stages sit, with no length, where they fall around it.
  expect(inMinutes(alone.collapsed)).toEqual({ "load-0": 0, "calibrate-1": 0, "export-2": 0 });

  const insideFilter = filteredAxis(stages, new Set<BuildPhase>(["calibrate"]), "calibrate-1");
  expect(inMinutes(insideFilter.starts)).toEqual({ "calibrate-1": 0 });
  expect(insideFilter.length).toBe(60 * MINUTE);
  expect(inMinutes(insideFilter.collapsed)).toEqual({ "load-0": 0, "export-2": 60, "calibrate-3": 60 });
});

describe("readings and sleeps under a filter", () => {
  const stages = [
    stage("load-0", "setup", 0, 10),
    stage("calibrate-1", "calibrate", 12, 72),
    stage("export-2", "export", 72, 77),
    stage("calibrate-3", "calibrate", 80, 90),
  ];
  const axis = filteredAxis(stages, new Set<BuildPhase>(["calibrate"]));

  test("a time inside a shown stage keeps its place in that stage", () => {
    expect(axisOffset(42 * MINUTE, stages, axis)).toBe(30 * MINUTE);
    expect(axisOffset(85 * MINUTE, stages, axis)).toBe(65 * MINUTE);
  });

  test("a time in a hidden stage, or between stages, is not on the axis", () => {
    expect(axisOffset(5 * MINUTE, stages, axis)).toBeNull();
    expect(axisOffset(11 * MINUTE, stages, axis)).toBeNull();
    expect(axisOffset(74 * MINUTE, stages, axis)).toBeNull();
  });

  test("a stretch keeps only its parts inside shown stages", () => {
    expect(axisIntervals(60 * MINUTE, 85 * MINUTE, stages, axis)).toEqual([
      { start: 48 * MINUTE, end: 60 * MINUTE },
      { start: 60 * MINUTE, end: 65 * MINUTE },
    ]);
    expect(axisIntervals(1 * MINUTE, 11 * MINUTE, stages, axis)).toEqual([]);
  });
});
