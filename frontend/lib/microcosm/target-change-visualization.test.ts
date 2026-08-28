import { describe, expect, test } from "bun:test";

import type { TargetChangeRow } from "./target-change";
import {
  formatTargetChange,
  targetChangeDetailValues,
  targetChangeDirectionAreas,
  targetChangeMapIdentity,
} from "./target-change-visualization";

describe("target change visualization data", () => {
  test("allocates direction area in exact proportion to gross movement", () => {
    const areas = targetChangeDirectionAreas({
      increasedError: 0.3,
      reducedError: 0.1,
      netChange: 0.2,
      changedTargets: 2,
      unchangedTargets: 0,
      sharedTargets: 2,
      addedTargets: 0,
      removedTargets: 0,
    }, 400, 200);
    const increase = areas.find((area) => area.data.direction === "increase");
    const reduction = areas.find((area) => area.data.direction === "reduction");
    expect((increase?.w ?? 0) * (increase?.h ?? 0)).toBeCloseTo(60_000);
    expect((reduction?.w ?? 0) * (reduction?.h ?? 0)).toBeCloseTo(20_000);
  });

  test("omits an empty direction without assigning false visual area", () => {
    const areas = targetChangeDirectionAreas({
      increasedError: 0,
      reducedError: 0.1,
      netChange: -0.1,
      changedTargets: 1,
      unchangedTargets: 0,
      sharedTargets: 1,
      addedTargets: 0,
      removedTargets: 0,
    }, 400, 200);
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
