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

function target(
  name: string,
  overrides: Partial<CalibrationTreeTarget>,
): CalibrationTreeTarget {
  return {
    name,
    abs_relative_error: 0.04,
    calibration_status: "included",
    target_dimensions: [],
    ...overrides,
  };
}

const rows: CalibrationTreeTarget[] = [
  target("population/child/CA", {
    source: "census",
    variable: "population",
    measure: "count",
    source_measure_id: "population",
    level: "state",
    geography: "CA",
    target_dimensions: [
      { key: "bd_age", label: "Age", value: "Child" },
      { key: "bd_sex", label: "Sex", value: "Female" },
    ],
  }),
  target("population/adult/CA", {
    source: "census",
    variable: "population",
    measure: "count",
    source_measure_id: "population",
    level: "state",
    geography: "CA",
    abs_relative_error: 0.12,
    calibration_status: "skipped",
    target_dimensions: [
      { key: "bd_age", label: "Age", value: "Adult" },
      { key: "bd_sex", label: "Sex", value: "Female" },
    ],
  }),
  target("population/child/NY", {
    source: "census",
    variable: "population",
    measure: "count",
    source_measure_id: "population",
    level: "state",
    geography: "NY",
    target_dimensions: [{ key: "bd_age", label: "Age", value: "Child" }],
  }),
  ...["CA", "United States"].flatMap((geography) =>
    ["count", "total"].map((measure) =>
      target(`ctc/${geography}/${measure}`, {
        source: "irs_soi",
        variable: "ctc",
        measure,
        source_measure_id: measure === "count" ? "ctc_claims" : "ctc_amount",
        level: geography === "United States" ? "national" : "state",
        geography,
        target_dimensions: [
          { key: "bd_income_band", label: "Income band", value: "All" },
          { key: "bd_filing_status", label: "Filing status", value: "All" },
        ],
      }),
    ),
  ),
  ...["All", "Under 1"].flatMap((incomeBand) =>
    ["count", "total"].map((measure) =>
      target(`interest/CA/${incomeBand}/${measure}`, {
        source: "irs_soi",
        variable: "taxable interest income",
        measure,
        source_measure_id:
          measure === "count" ? "taxable_interest_returns" : "taxable_interest_amount",
        level: "state",
        geography: "CA",
        target_dimensions: [
          { key: "bd_income_band", label: "Income band", value: incomeBand },
          { key: "bd_filing_status", label: "Filing status", value: "All" },
        ],
      }),
    ),
  ),
];

describe("source, geography, and declared-dimension hierarchy", () => {
  test("renders statistics inside source groups at the overview", () => {
    const tree = buildCalibrationTree(rows, state({ dimensions: [] }), "release-1");

    expect(tree.currentLevel).toEqual({ kind: "overview", label: "Programs" });
    expect(tree.groups.map((group) => group.id)).toEqual(["irs_soi", "census"]);
    expect(tree.groups.flatMap((group) => group.nodes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "program",
          label: "ctc",
          selection: { kind: "program", source: "irs_soi", value: "ctc" },
          metrics: expect.objectContaining({ nTargets: 4 }),
        }),
        expect.objectContaining({
          kind: "program",
          label: "population",
          metrics: expect.objectContaining({ nTargets: 3 }),
        }),
      ]),
    );
  });

  test("descends directly from a statistic to geography without a measure level", () => {
    const tree = buildCalibrationTree(
      rows,
      state({ source: "irs_soi", program: "ctc", dimensions: [] }),
    );

    expect(tree.currentLevel).toEqual({ kind: "geography", label: "Geography" });
    expect(tree.groups[0].nodes.map((node) => [node.id, node.metrics.nTargets])).toEqual([
      ["CA", 2],
      ["United States", 2],
    ]);
    expect(tree.groups[0].nodes[0].selection).toEqual({ kind: "geography", value: "CA" });
  });

  test("shows CTC targets immediately because its declared dimensions are constant", () => {
    const tree = buildCalibrationTree(
      rows,
      state({ source: "irs_soi", program: "ctc", geography: "CA", dimensions: [] }),
    );

    expect(tree.currentLevel).toEqual({ kind: "target", label: "Targets" });
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0].nodes.map((node) => [node.kind, node.id, node.label])).toEqual([
      ["target", "ctc/CA/total", "Ctc Amount"],
      ["target", "ctc/CA/count", "Ctc Claims"],
    ]);
    expect(tree.dimensionOrder).toEqual([
      { key: "bd_income_band", label: "Income band" },
      { key: "bd_filing_status", label: "Filing status" },
    ]);
  });

  test("keeps All as an income-band value when other values exist and skips filing status", () => {
    const income = buildCalibrationTree(
      rows,
      state({
        source: "irs_soi",
        program: "taxable interest income",
        geography: "CA",
        dimensions: [],
      }),
    );

    expect(income.currentLevel).toEqual({
      kind: "dimension",
      key: "bd_income_band",
      label: "Income band",
    });
    expect(income.groups[0].nodes.map((node) => [node.label, node.metrics.nTargets])).toEqual([
      ["All", 2],
      ["Under 1", 2],
    ]);

    const targets = buildCalibrationTree(
      rows,
      state({
        source: "irs_soi",
        program: "taxable interest income",
        geography: "CA",
        dimensions: [{ key: "bd_income_band", label: "Income band", value: "All" }],
      }),
    );
    expect(targets.currentLevel).toEqual({ kind: "target", label: "Targets" });
    expect(targets.groups[0].nodes).toHaveLength(2);
  });

  test("uses only the recognized varying dimensions present beneath a geography", () => {
    const tree = buildCalibrationTree(
      rows,
      state({ source: "census", program: "population", geography: "CA", dimensions: [] }),
    );

    expect(tree.currentLevel).toEqual({ kind: "dimension", key: "bd_age", label: "Age" });
    expect(tree.groups[0].nodes.map((node) => node.label)).toEqual(["Adult", "Child"]);
    expect(tree.dimensionOrder).toEqual([{ key: "bd_age", label: "Age" }]);
  });

  test("partitions sparse and ambiguous dimensions without missing buckets or duplicate targets", () => {
    const sparseRows = [
      target("sparse/age/adult", {
        source: "test",
        variable: "sparse",
        geography: "United States",
        target_dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
      }),
      target("sparse/age/senior", {
        source: "test",
        variable: "sparse",
        geography: "United States",
        target_dimensions: [{ key: "bd_age", label: "Age", value: "Senior" }],
      }),
      target("sparse/program/a", {
        source: "test",
        variable: "sparse",
        geography: "United States",
        target_dimensions: [{ key: "bd_program", label: "Program", value: "A" }],
      }),
      target("sparse/program/b", {
        source: "test",
        variable: "sparse",
        geography: "United States",
        target_dimensions: [{ key: "bd_program", label: "Program", value: "B" }],
      }),
      target("sparse/no-dimensions", {
        source: "test",
        variable: "sparse",
        geography: "United States",
      }),
      target("sparse/ambiguous-income", {
        source: "test",
        variable: "sparse",
        geography: "United States",
        target_dimensions: [
          { key: "bd_income_band", label: "Income band", value: "All" },
          { key: "bd_income_band", label: "Income band", value: "Total" },
        ],
      }),
    ];

    const tree = buildCalibrationTree(
      sparseRows,
      state({ source: "test", program: "sparse", geography: "United States", dimensions: [] }),
    );

    expect(tree.currentLevel).toEqual({ kind: "mixed", label: "Breakdowns and targets" });
    expect(tree.groups.map((group) => [group.id, group.nodes.length, group.metrics.nTargets])).toEqual([
      ["bd_age", 2, 2],
      ["bd_program", 2, 2],
      ["targets", 2, 2],
    ]);
    expect(tree.groups.flatMap((group) => group.nodes).some((node) => node.id === "__missing__")).toBe(false);
    expect(tree.groups.reduce((sum, group) => sum + group.metrics.nTargets, 0)).toBe(6);
    expect(tree.groups.find((group) => group.id === "targets")?.nodes.map((node) => node.id)).toEqual([
      "sparse/ambiguous-income",
      "sparse/no-dimensions",
    ]);
  });
});

describe("calibration tree metrics and filters", () => {
  test("falls back to target count when the selected sizing metric is all zero", () => {
    const nodes = buildCalibrationTree(
      rows.map((row) => ({ ...row, abs_relative_error: null })),
      state({ dimensions: [] }),
    ).groups.flatMap((group) => group.nodes);

    expect(effectiveNodeMetric(nodes, "loss")).toEqual(nodes.map((node) => node.metrics.nTargets));
    expect(effectiveNodeMetric(nodes, "error_intensity")).toEqual(nodes.map((node) => node.metrics.nTargets));
  });

  test("classifies fit bands on the legend boundaries", () => {
    const band = (abs_relative_error: number | null) => fitBandForTarget({ abs_relative_error });
    expect([
      band(0), band(0.05), band(0.050001), band(0.1), band(0.100001),
      band(0.2), band(0.200001), band(0.4), band(0.400001), band(null),
    ]).toEqual([
      "0_5", "0_5", "5_10", "5_10", "10_20",
      "10_20", "20_40", "20_40", "40_plus", "unscored",
    ]);
  });

  test("ORs values within filters and ANDs across filter categories", () => {
    const filtered = applyExplorerFilters(rows, {
      geographyLevels: ["state"],
      geographies: ["CA", "NY"],
      fitBands: ["0_5", "10_20"],
      calibrationStatuses: ["included", "skipped"],
    });

    expect(filtered.filter((row) => row.variable === "population").map((row) => row.name)).toEqual([
      "population/child/CA",
      "population/adult/CA",
      "population/child/NY",
    ]);
  });

  test("keeps branch dimensions stable when filters leave only one visible value", () => {
    const tree = buildCalibrationTree(rows, {
      path: {
        source: "census",
        program: "population",
        geography: "CA",
        dimensions: [],
      },
      filters: {
        geographyLevels: ["state"],
        geographies: ["CA"],
        fitBands: ["0_5"],
        calibrationStatuses: ["included"],
      },
    });

    expect(tree.currentLevel).toEqual({ kind: "dimension", key: "bd_age", label: "Age" });
    expect(tree.groups[0].nodes.map((node) => node.label)).toEqual(["Child"]);
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
