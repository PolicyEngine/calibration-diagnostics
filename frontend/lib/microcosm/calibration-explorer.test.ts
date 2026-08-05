import { describe, expect, test } from "bun:test";

import {
  createExplorerState,
  explorerReducer,
  parentExplorerState,
  selectExplorerNode,
  type ExplorerState,
} from "./calibration-explorer";

function state(overrides: Partial<ExplorerState> = {}): ExplorerState {
  return {
    path: { dimensions: [] },
    filters: {
      geographyLevels: [],
      geographies: [],
      fitBands: [],
      calibrationStatuses: [],
    },
    ...overrides,
  };
}

describe("calibration explorer semantic navigation", () => {
  test("starts at all programs with no inherited route state", () => {
    expect(createExplorerState()).toEqual(state());
  });

  test("program selection atomically records source and program", () => {
    const selected = selectExplorerNode(state(), {
      kind: "program",
      source: "census",
      value: "population",
    });

    expect(selected.path).toEqual({
      source: "census",
      program: "population",
      dimensions: [],
    });
  });

  test("up removes dimensions, then geography, then source and program together", () => {
    const filters = {
      geographyLevels: ["state"],
      geographies: ["CA"],
      fitBands: ["10_20" as const],
      calibrationStatuses: ["included" as const],
    };
    const deep = state({
      path: {
        source: "census",
        program: "population",
        geography: "CA",
        dimensions: [
          { key: "bd_age", value: "65_plus" },
          { key: "bd_sex", value: "female" },
        ],
        target: "target/1",
      },
      filters,
    });

    const one = parentExplorerState(deep);
    expect(one.path.target).toBeUndefined();
    expect(one.path.dimensions).toEqual([{ key: "bd_age", value: "65_plus" }]);
    expect(one.filters).toEqual(filters);

    const two = parentExplorerState(one);
    expect(two.path.dimensions).toEqual([]);
    expect(two.path.geography).toBe("CA");

    const three = parentExplorerState(two);
    expect(three.path.geography).toBeUndefined();
    expect(three.path.program).toBe("population");

    const root = parentExplorerState(three);
    expect(root.path).toEqual({ dimensions: [] });
    expect(root.filters).toEqual(filters);
  });

  test("drills and moves up entirely through local reducer state", () => {
    const root = createExplorerState();
    const program = explorerReducer(root, {
      type: "select",
      selection: { kind: "program", source: "census", value: "population" },
    });
    const geography = explorerReducer(program, {
      type: "select",
      selection: { kind: "geography", value: "CA" },
    });

    expect(geography.path).toEqual({
      source: "census",
      program: "population",
      geography: "CA",
      dimensions: [],
    });
    expect(explorerReducer(geography, { type: "up" }).path.geography).toBeUndefined();
    expect(explorerReducer(program, { type: "up" })).toEqual(root);
  });

  test("requires geography before declared dimensions or targets", () => {
    const program = selectExplorerNode(state(), {
      kind: "program",
      source: "irs_soi",
      value: "ctc",
    });

    expect(
      selectExplorerNode(program, {
        kind: "dimension_value",
        key: "bd_income_band",
        label: "Income band",
        value: "All",
      }),
    ).toEqual(program);
    expect(
      selectExplorerNode(program, { kind: "target", value: "ctc/al/count" }),
    ).toEqual(program);
  });
});
