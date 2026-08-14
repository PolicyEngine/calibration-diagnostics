import { describe, expect, test } from "bun:test";

import { createExplorerState, type ExplorerState } from "./calibration-explorer";
import {
  prefetchCalibrationDescendants,
  type CalibrationTreeFetcher,
} from "./calibration-prefetch";
import type {
  CalibrationTreeNode,
  CalibrationTreeResponse,
} from "./calibration-tree";

const EMPTY_METRICS = {
  nTargets: 0,
  scored: 0,
  within10Pct: 0,
  loss: 0,
  huberLoss: 0,
  huberErrorIntensity: null,
  meanAbsRelativeError: null,
  medianAbsRelativeError: null,
};

function response(
  state: ExplorerState,
  nodes: CalibrationTreeNode[],
): CalibrationTreeResponse {
  return {
    path: state.path,
    currentLevel: { kind: "overview", label: "Test" },
    groups: [{ id: "test", label: "Test", nodes, metrics: EMPTY_METRICS }],
    dimensionOrder: [],
    filterOptions: {
      geographyLevels: [],
      geographies: [],
      fitBands: [],
      calibrationStatuses: [],
    },
    filteredMetrics: EMPTY_METRICS,
  };
}

function program(value: string): CalibrationTreeNode {
  return {
    id: value,
    label: value,
    kind: "program",
    selection: { kind: "program", source: "source", value },
    metrics: EMPTY_METRICS,
  };
}

function geography(value: string): CalibrationTreeNode {
  return {
    id: value,
    label: value,
    kind: "geography",
    selection: { kind: "geography", value },
    metrics: EMPTY_METRICS,
  };
}

function dimension(value: string): CalibrationTreeNode {
  return {
    id: value,
    label: value,
    kind: "dimension_value",
    selection: {
      kind: "dimension_value",
      key: "bd_age",
      label: "Age",
      value,
    },
    metrics: EMPTY_METRICS,
  };
}

function target(value: string): CalibrationTreeNode {
  return {
    id: value,
    label: value,
    kind: "target",
    selection: { kind: "target", value },
    metrics: EMPTY_METRICS,
  };
}

function pathKey(state: ExplorerState): string {
  const path = state.path;
  return [
    path.program,
    path.geography,
    ...path.dimensions.map((item) => item.value),
  ]
    .filter(Boolean)
    .join("/");
}

describe("calibration tree descendant prefetch", () => {
  test("walks exactly three selectable levels and never requests target leaves", async () => {
    const root = createExplorerState();
    const requested: string[] = [];
    const fetchTree: CalibrationTreeFetcher = async (state) => {
      const key = pathKey(state);
      requested.push(key);
      if (key === "program") return response(state, [geography("CA")]);
      if (key === "program/CA") return response(state, [dimension("Adult")]);
      if (key === "program/CA/Adult") return response(state, [target("target-1")]);
      throw new Error(`Unexpected state: ${key}`);
    };

    const result = await prefetchCalibrationDescendants({
      state: root,
      data: response(root, [program("program")]),
      depth: 3,
      concurrency: 2,
      fetchTree,
    });

    expect(requested).toEqual([
      "program",
      "program/CA",
      "program/CA/Adult",
    ]);
    expect(result).toEqual({ requested: 3, loaded: 3, levelsCompleted: 3 });
  });

  test("deduplicates identical child states before fetching", async () => {
    const root = createExplorerState();
    let requests = 0;

    await prefetchCalibrationDescendants({
      state: root,
      data: response(root, [program("same"), program("same")]),
      depth: 1,
      fetchTree: async (state) => {
        requests += 1;
        return response(state, []);
      },
    });

    expect(requests).toBe(1);
  });

  test("bounds simultaneous requests while preserving all branches", async () => {
    const root = createExplorerState();
    let active = 0;
    let maximumActive = 0;
    const requested: string[] = [];

    await prefetchCalibrationDescendants({
      state: root,
      data: response(
        root,
        ["one", "two", "three", "four", "five"].map(program),
      ),
      depth: 1,
      concurrency: 2,
      fetchTree: async (state) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        requested.push(pathKey(state));
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return response(state, []);
      },
    });

    expect(maximumActive).toBe(2);
    expect(requested.sort()).toEqual(["five", "four", "one", "three", "two"]);
  });

  test("skips a failed branch and continues prefetching its siblings", async () => {
    const root = createExplorerState();
    const result = await prefetchCalibrationDescendants({
      state: root,
      data: response(root, [program("good"), program("failed")]),
      depth: 2,
      fetchTree: async (state) =>
        pathKey(state) === "failed"
          ? null
          : response(state, [geography("CA")]),
    });

    expect(result).toEqual({ requested: 3, loaded: 2, levelsCompleted: 2 });
  });
});
