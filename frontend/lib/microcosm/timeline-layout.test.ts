import { expect, test } from "bun:test";

import type { BuildPhase } from "@/lib/microcosm/build-monitor";
import { filteredAxis, phasesByFirstAppearance, type StageExtent } from "@/lib/microcosm/timeline-layout";

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
