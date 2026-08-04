import { describe, expect, test } from "bun:test";

import {
  parentExplorerState,
  parseExplorerSearch,
  selectExplorerNode,
  serializeExplorerSearch,
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
  test("parses and serializes a readable hierarchy with repeated filters", () => {
    const params = new URLSearchParams(
      "release=2026-07&source=census&program=population&measure=count" +
        "&dim.bd_age=65_plus&geography_level=state&geography=CA&geography=NY" +
        "&fit_band=5_10&status=included",
    );

    const parsed = parseExplorerSearch(params);

    expect(parsed.path).toEqual({
      source: "census",
      program: "population",
      measure: "count",
      dimensions: [{ key: "bd_age", value: "65_plus" }],
    });
    expect(parsed.filters.geographies).toEqual(["CA", "NY"]);
    expect(parsed.filters.fitBands).toEqual(["5_10"]);

    const serialized = serializeExplorerSearch(parsed, params);
    expect(serialized.get("release")).toBe("2026-07");
    expect(serialized.getAll("geography")).toEqual(["CA", "NY"]);
    expect(serialized.get("dim.bd_age")).toBe("65_plus");
    expect(serialized.has("drill")).toBe(false);
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

  test("up removes dimensions, then measure, then source and program together", () => {
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
        measure: "count",
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
    expect(two.path.measure).toBe("count");

    const three = parentExplorerState(two);
    expect(three.path.measure).toBeUndefined();
    expect(three.path.program).toBe("population");

    const root = parentExplorerState(three);
    expect(root.path).toEqual({ dimensions: [] });
    expect(root.filters).toEqual(filters);
  });

  test("drops structurally impossible descendants while keeping independent filters", () => {
    const parsed = parseExplorerSearch(
      new URLSearchParams(
        "measure=count&dim.bd_age=65_plus&geography=CA&fit_band=not-a-band&status=skipped",
      ),
    );

    expect(parsed.path).toEqual({ dimensions: [] });
    expect(parsed.filters.geographies).toEqual(["CA"]);
    expect(parsed.filters.fitBands).toEqual([]);
    expect(parsed.filters.calibrationStatuses).toEqual(["skipped"]);
  });
});
