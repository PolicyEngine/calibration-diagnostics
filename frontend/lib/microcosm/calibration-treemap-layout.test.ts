import { describe, expect, test } from "bun:test";

import type {
  CalibrationTreeGroup,
  CalibrationTreeMetrics,
  CalibrationTreeNode,
} from "./calibration-tree";
import {
  condenseCalibrationTreemap,
  expandedGroupsForNode,
} from "./calibration-treemap-layout";

function metrics(
  nTargets: number,
  overrides: Partial<CalibrationTreeMetrics> = {},
): CalibrationTreeMetrics {
  return {
    nTargets,
    scored: nTargets,
    within10Pct: nTargets,
    loss: nTargets,
    huberLoss: nTargets / 2,
    huberErrorIntensity: 1,
    meanAbsRelativeError: 0.1,
    medianAbsRelativeError: 0.1,
    ...overrides,
  };
}

function node(id: string, nTargets: number): CalibrationTreeNode {
  return {
    id,
    label: id,
    kind: "geography",
    selection: { kind: "geography", value: id },
    metrics: metrics(nTargets),
  };
}

function group(
  id: string,
  nodes: CalibrationTreeNode[],
  nTargets = nodes.reduce((sum, item) => sum + item.metrics.nTargets, 0),
): CalibrationTreeGroup {
  return {
    id,
    label: id,
    nodes,
    metrics: metrics(nTargets),
  };
}

describe("calibration treemap legibility grouping", () => {
  test("rolls multiple nodes below the legacy projected-area threshold into +N more", () => {
    const large = node("large", 90);
    const firstSmall = node("first-small", 5);
    const secondSmall = node("second-small", 5);
    const source = group("source", [large, firstSmall, secondSmall]);

    const [displayGroup] = condenseCalibrationTreemap(
      [source],
      "targets",
      100,
      100,
    );

    expect(displayGroup.nodes.map((item) => item.label)).toEqual([
      "large",
      "+2 more",
    ]);
    const grouped = displayGroup.nodes[1];
    expect(grouped.kind).toBe("grouped");
    expect(grouped.metrics.nTargets).toBe(10);
    expect(expandedGroupsForNode(grouped)).toEqual([
      expect.objectContaining({
        id: "source",
        label: "source",
        nodes: [firstSmall, secondSmall],
      }),
    ]);
  });

  test("does not hide a lone small node behind an unnecessary grouped tile", () => {
    const source = group("source", [node("large", 99), node("small", 1)]);

    const [displayGroup] = condenseCalibrationTreemap(
      [source],
      "targets",
      100,
      100,
    );

    expect(displayGroup.nodes.map((item) => item.label)).toEqual([
      "large",
      "small",
    ]);
    expect(displayGroup.nodes.every((item) => item.kind !== "grouped")).toBe(true);
  });

  test("rolls multiple small outer groups together while preserving every source", () => {
    const large = group("large-source", [node("large", 90)], 90);
    const firstSmall = group("first-source", [node("first", 5)], 5);
    const secondSmall = group("second-source", [node("second", 5)], 5);

    const display = condenseCalibrationTreemap(
      [large, firstSmall, secondSmall],
      "targets",
      100,
      100,
    );

    expect(display.map((item) => item.label)).toEqual([
      "large-source",
      "Other sources",
    ]);
    expect(display[1].nodes).toHaveLength(1);
    expect(display[1].nodes[0].label).toBe("Other sources (2)");
    expect(expandedGroupsForNode(display[1].nodes[0])).toEqual([
      firstSmall,
      secondSmall,
    ]);
  });

  test("uses target count for grouping when every selected metric is zero", () => {
    const source = group("source", [
      node("large", 90),
      { ...node("first-small", 5), metrics: metrics(5, { loss: 0 }) },
      { ...node("second-small", 5), metrics: metrics(5, { loss: 0 }) },
    ]);
    source.nodes[0] = {
      ...source.nodes[0],
      metrics: metrics(90, { loss: 0 }),
    };
    source.metrics = metrics(100, { loss: 0 });

    const [displayGroup] = condenseCalibrationTreemap(
      [source],
      "loss",
      100,
      100,
    );

    expect(displayGroup.nodes.map((item) => item.label)).toEqual([
      "large",
      "+2 more",
    ]);
  });

  test("aggregates additive metrics and recalculates Huber intensity", () => {
    const first = {
      ...node("first", 1),
      metrics: metrics(1, {
        scored: 1,
        within10Pct: 1,
        loss: 2,
        huberLoss: 0.5,
        meanAbsRelativeError: 0.1,
        medianAbsRelativeError: 0.1,
      }),
    };
    const second = {
      ...node("second", 2),
      metrics: metrics(2, {
        scored: 2,
        within10Pct: 0,
        loss: 4,
        huberLoss: 4,
        meanAbsRelativeError: 0.4,
        medianAbsRelativeError: 0.4,
      }),
    };
    const source = group("source", [node("large", 97), first, second]);

    const grouped = condenseCalibrationTreemap(
      [source],
      "targets",
      100,
      100,
    )[0].nodes.at(-1);

    expect(grouped?.metrics).toEqual({
      nTargets: 3,
      scored: 3,
      within10Pct: 1,
      loss: 6,
      huberLoss: 4.5,
      huberErrorIntensity: Math.sqrt(3),
      meanAbsRelativeError: 0.3,
      medianAbsRelativeError: 0.3,
    });
  });
});
