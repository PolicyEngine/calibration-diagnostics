import { describe, expect, test } from "bun:test";

import type { ExplorerState } from "./calibration-explorer";
import {
  applyExplorerFilters,
  buildCalibrationTree,
  effectiveNodeMetric,
  fitBandForTarget,
  type CalibrationTreeTarget,
} from "./calibration-tree";

const EMPTY_FILTERS = {
  geographyLevels: [],
  geographies: [],
  fitBands: [],
  calibrationStatuses: [],
};

function state(path: ExplorerState["path"]): ExplorerState {
  return { path, filters: EMPTY_FILTERS };
}

const rows: CalibrationTreeTarget[] = [
  {
    name: "population/count/adult/female/CA",
    source: "census",
    variable: "population",
    measure: "count",
    level: "state",
    geography: "CA",
    abs_relative_error: 0.04,
    calibration_status: "included",
    target_dimensions: [
      { key: "bd_age", label: "Age", value: "Adult" },
      { key: "bd_sex", label: "Sex", value: "Female" },
    ],
  },
  {
    name: "population/count/senior/female/NY",
    source: "census",
    variable: "population",
    measure: "count",
    level: "state",
    geography: "NY",
    abs_relative_error: 0.12,
    calibration_status: "skipped",
    target_dimensions: [
      { key: "bd_age", label: "Age", value: "Senior" },
      { key: "bd_sex", label: "Sex", value: "Female" },
    ],
  },
  {
    name: "population/count/unspecified/female",
    source: "census",
    variable: "population",
    measure: "count",
    level: "national",
    geography: "United States",
    abs_relative_error: null,
    calibration_status: "not_materialized",
    target_dimensions: [{ key: "bd_sex", label: "Sex", value: "Female" }],
  },
  {
    name: "population/amount/adult/US",
    source: "census",
    variable: "population",
    measure: "total",
    level: "national",
    geography: "United States",
    abs_relative_error: 0.02,
    calibration_status: "included",
    target_dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
  },
  {
    name: "taxable-interest/count/US",
    source: "irs_soi",
    variable: "taxable interest income",
    measure: "count",
    level: "national",
    geography: "United States",
    abs_relative_error: 0.08,
    calibration_status: "included",
    target_dimensions: [],
  },
];

describe("fixed calibration tree aggregation", () => {
  test("renders programs inside source groups at the overview", () => {
    const tree = buildCalibrationTree(rows, state({ dimensions: [] }), "release-1");

    expect(tree.currentLevel).toEqual({ kind: "overview", label: "Programs" });
    expect(tree.groups.map((group) => group.id)).toEqual(["census", "irs_soi"]);
    expect(tree.groups[0].nodes[0]).toMatchObject({
      kind: "program",
      label: "population",
      selection: { kind: "program", source: "census", value: "population" },
      metrics: { nTargets: 4 },
    });
    expect(tree.groups.flatMap((group) => group.nodes).some((node) => node.id.includes("other"))).toBe(false);
  });

  test("descends from program to measure even when a level has one value", () => {
    const population = buildCalibrationTree(
      rows,
      state({ source: "census", program: "population", dimensions: [] }),
    );
    expect(population.currentLevel).toEqual({ kind: "measure", label: "Measure" });
    expect(population.groups[0].nodes.map((node) => node.id)).toEqual(["count", "total"]);

    const interest = buildCalibrationTree(
      rows,
      state({ source: "irs_soi", program: "taxable interest income", dimensions: [] }),
    );
    expect(interest.groups[0].nodes.map((node) => node.id)).toEqual(["count"]);
  });

  test("uses every non-geographic dimension in stable order and groups missing values", () => {
    const tree = buildCalibrationTree(
      rows,
      state({
        source: "census",
        program: "population",
        measure: "count",
        dimensions: [],
      }),
    );

    expect(tree.dimensionOrder).toEqual([
      { key: "bd_age", label: "Age" },
      { key: "bd_sex", label: "Sex" },
    ]);
    expect(tree.currentLevel).toEqual({ kind: "dimension", key: "bd_age", label: "Age" });
    expect(tree.groups[0].nodes.map((node) => [node.id, node.label])).toEqual([
      ["Adult", "Adult"],
      ["Senior", "Senior"],
      ["__missing__", "Not specified"],
    ]);
    expect(tree.dimensionOrder.some((dimension) => dimension.key === "geography")).toBe(false);
    expect(tree.dimensionOrder.some((dimension) => dimension.key === "level")).toBe(false);
  });

  test("shows singleton dimensions and then individual target tiles", () => {
    const sex = buildCalibrationTree(
      rows,
      state({
        source: "census",
        program: "population",
        measure: "count",
        dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
      }),
    );
    expect(sex.currentLevel).toEqual({ kind: "dimension", key: "bd_sex", label: "Sex" });
    expect(sex.groups[0].nodes.map((node) => node.label)).toEqual(["Female"]);

    const targets = buildCalibrationTree(
      rows,
      state({
        source: "census",
        program: "population",
        measure: "count",
        dimensions: [
          { key: "bd_age", label: "Age", value: "Adult" },
          { key: "bd_sex", label: "Sex", value: "Female" },
        ],
      }),
    );
    expect(targets.currentLevel).toEqual({ kind: "target", label: "Targets" });
    expect(targets.groups[0].nodes).toHaveLength(1);
    expect(targets.groups[0].nodes[0]).toMatchObject({
      kind: "target",
      id: "population/count/adult/female/CA",
      target: { geography: "CA" },
    });
  });

  test("falls back to target count when the selected sizing metric is all zero", () => {
    const nodes = buildCalibrationTree(
      rows.filter((row) => row.abs_relative_error == null),
      state({ dimensions: [] }),
    ).groups.flatMap((group) => group.nodes);

    expect(effectiveNodeMetric(nodes, "loss")).toEqual([1]);
    expect(effectiveNodeMetric(nodes, "error_intensity")).toEqual([1]);
  });
});

describe("orthogonal calibration tree filters", () => {
  test("classifies fit bands on the legend boundaries", () => {
    const band = (abs_relative_error: number | null) =>
      fitBandForTarget({ abs_relative_error });

    expect([
      band(0),
      band(0.05),
      band(0.050001),
      band(0.1),
      band(0.100001),
      band(0.2),
      band(0.200001),
      band(0.4),
      band(0.400001),
      band(null),
    ]).toEqual([
      "0_5",
      "0_5",
      "5_10",
      "5_10",
      "10_20",
      "10_20",
      "20_40",
      "20_40",
      "40_plus",
      "unscored",
    ]);
  });

  test("ORs values within filters and ANDs across filter categories", () => {
    const filtered = applyExplorerFilters(rows, {
      geographyLevels: ["state"],
      geographies: ["CA", "NY"],
      fitBands: ["0_5", "10_20"],
      calibrationStatuses: ["included", "skipped"],
    });

    expect(filtered.map((row) => row.name)).toEqual([
      "population/count/adult/female/CA",
      "population/count/senior/female/NY",
    ]);
  });

  test("applies filters to nodes and metrics without changing dimension order", () => {
    const tree = buildCalibrationTree(rows, {
      path: {
        source: "census",
        program: "population",
        measure: "count",
        dimensions: [],
      },
      filters: {
        geographyLevels: ["state"],
        geographies: ["CA"],
        fitBands: [],
        calibrationStatuses: ["included"],
      },
    });

    expect(tree.dimensionOrder).toEqual([
      { key: "bd_age", label: "Age" },
      { key: "bd_sex", label: "Sex" },
    ]);
    expect(tree.groups[0].nodes.map((node) => node.label)).toEqual(["Adult"]);
    expect(tree.filteredMetrics.nTargets).toBe(1);
  });

  test("supports missing geography as an explicit filter value", () => {
    const missing = applyExplorerFilters(
      [...rows, { name: "missing-place", source: "other", variable: "unknown" }],
      {
        geographyLevels: [],
        geographies: ["__missing__"],
        fitBands: [],
        calibrationStatuses: [],
      },
    );

    expect(missing.map((row) => row.name)).toEqual(["missing-place"]);
  });
});
