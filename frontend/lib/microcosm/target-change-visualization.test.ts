import { describe, expect, test } from "bun:test";

import type {
  CalibrationTreeGroup,
  CalibrationTreeMetrics,
} from "./calibration-tree";
import type { TargetChangeRow } from "./target-change";
import {
  formatTargetChange,
  targetChangeDetailValues,
  targetChangeDirectionAreas,
  targetChangeDirectionValue,
  targetChangeGroupsForDirection,
  targetChangeMapIdentity,
} from "./target-change-visualization";

function changeMetrics(
  netChange: number,
  increasedError: number,
  reducedError: number,
): CalibrationTreeMetrics {
  return {
    nTargets: 1,
    scored: 1,
    within10Pct: 1,
    loss: 0,
    targetLossWeightShare: 0,
    weightedAverageCappedError: null,
    meanAbsRelativeError: null,
    medianAbsRelativeError: null,
    change: {
      increasedError,
      reducedError,
      netChange,
      changedTargets: 1,
      unchangedTargets: 0,
      sharedTargets: 1,
      addedTargets: 0,
      removedTargets: 0,
    },
  };
}

function groupWithChanges(changes: number[]): CalibrationTreeGroup {
  const nodes = changes.map((change, index) => ({
    id: `category-${index}`,
    label: `Category ${index}`,
    kind: "program" as const,
    selection: {
      kind: "program" as const,
      source: "source",
      value: `category-${index}`,
    },
    metrics: changeMetrics(
      change,
      change > 0 ? change : 0,
      change < 0 ? -change : 0,
    ),
  }));
  return {
    id: "source",
    label: "Source",
    nodes,
    metrics: changeMetrics(
      changes.reduce((sum, change) => sum + change, 0),
      changes.reduce((sum, change) => sum + Math.max(change, 0), 0),
      changes.reduce((sum, change) => sum + Math.max(-change, 0), 0),
    ),
  };
}

describe("target change visualization data", () => {
  test("assigns a mixed-target category only to its net direction", () => {
    const mixedCategory = changeMetrics(0.2, 0.3, 0.1);
    expect(targetChangeDirectionValue(mixedCategory, "increase")).toBeCloseTo(0.2);
    expect(targetChangeDirectionValue(mixedCategory, "reduction")).toBe(0);
  });

  test("keeps increases left and reductions right when reductions are larger", () => {
    const areas = targetChangeDirectionAreas(
      [groupWithChanges([0.1, -0.2])],
      400,
      200,
    );
    const increase = areas.find((area) => area.data.direction === "increase");
    const reduction = areas.find((area) => area.data.direction === "reduction");
    expect(increase?.x).toBe(0);
    expect(reduction?.x).toBeCloseTo(increase?.w ?? 0);
    expect(increase?.h).toBe(200);
    expect(reduction?.h).toBe(200);
    expect((increase?.w ?? 0) * (increase?.h ?? 0)).toBeCloseTo(80_000 * (1 / 3));
    expect((reduction?.w ?? 0) * (reduction?.h ?? 0)).toBeCloseTo(80_000 * (2 / 3));
  });

  test("places each category in only one directional group", () => {
    const group = groupWithChanges([0.2, -0.1, 0]);
    const increased = targetChangeGroupsForDirection([group], "increase");
    const reduced = targetChangeGroupsForDirection([group], "reduction");
    expect(increased[0].nodes.map((node) => node.id)).toEqual(["category-0"]);
    expect(reduced[0].nodes.map((node) => node.id)).toEqual(["category-1"]);
    expect(increased[0].metrics.change?.netChange).toBeCloseTo(0.2);
    expect(reduced[0].metrics.change?.netChange).toBeCloseTo(-0.1);
  });

  test("omits an empty direction without assigning false visual area", () => {
    const areas = targetChangeDirectionAreas(
      [groupWithChanges([-0.1])],
      400,
      200,
    );
    expect(areas).toHaveLength(1);
    expect(areas[0].data.direction).toBe("reduction");
    expect(areas[0].w * areas[0].h).toBeCloseTo(80_000);
  });

  test("formats weighted error changes as percentage points", () => {
    expect(formatTargetChange(0.004)).toBe("+0.40 pp");
    expect(formatTargetChange(-0.004)).toBe("−0.40 pp");
    expect(formatTargetChange(0)).toBe("±0.00 pp");
    expect(formatTargetChange(null)).toBe("—");
  });

  test("changes visual identity when the run or resolved release changes", () => {
    expect(targetChangeMapIdentity("run-a", "release-a")).not.toBe(
      targetChangeMapIdentity("run-b", "release-a"),
    );
    expect(targetChangeMapIdentity("run-a", "release-a")).not.toBe(
      targetChangeMapIdentity("run-a", "release-b"),
    );
  });

  test("selects actual or pooled contributions for target detail", () => {
    const target = {
      reported_change: 0.02,
      pooled_weight_share: 0.4,
      shared_current_contribution: 0.04,
      shared_candidate_contribution: 0.06,
      shared_change: 0.02,
      current: { weightShare: 0.3, contribution: 0.03 },
      candidate: { weightShare: 0.5, contribution: 0.05 },
    } as TargetChangeRow;
    expect(targetChangeDetailValues(target, "reported")).toEqual(expect.objectContaining({
      comparisonWeight: null,
      currentContribution: 0.03,
      candidateContribution: 0.05,
      change: 0.02,
    }));
    expect(targetChangeDetailValues(target, "shared")).toEqual(expect.objectContaining({
      comparisonWeight: 0.4,
      currentContribution: 0.04,
      candidateContribution: 0.06,
      change: 0.02,
    }));
  });
});
