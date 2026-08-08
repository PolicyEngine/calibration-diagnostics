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

function state(
  path: ExplorerState["path"],
  breakdown: ExplorerState["breakdown"] = "program",
): ExplorerState {
  return { breakdown, path, filters: EMPTY_FILTERS };
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
  test("skips a meaningless singleton missing-geography tier", () => {
    const geographylessRows = ["Adult", "Child"].map((age) =>
      target(`geographyless/${age}`, {
        source: "test",
        variable: "geographyless program",
        target_dimensions: [{ key: "bd_age", label: "Age", value: age }],
      }),
    );
    const programPath = {
      source: "test",
      program: "geographyless program",
      dimensions: [],
    };
    const tree = buildCalibrationTree(geographylessRows, state(programPath));

    expect(tree.currentLevel).toEqual({ kind: "dimension", key: "bd_age", label: "Age" });
    expect(tree.groups.map((group) => group.id)).toEqual(["bd_age"]);
    expect(tree.groups[0].nodes.map((node) => node.label)).toEqual(["Adult", "Child"]);

    const adult = buildCalibrationTree(
      geographylessRows,
      state({
        ...programPath,
        dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
      }),
    );
    expect(adult.currentLevel).toEqual({ kind: "target", label: "Targets" });
    expect(adult.groups[0].nodes.map((node) => node.id)).toEqual([
      "geographyless/Adult",
    ]);
  });

  test("renders statistics inside source groups at the overview", () => {
    const tree = buildCalibrationTree(rows, state({ dimensions: [] }), "release-1");

    expect(tree.currentLevel).toEqual({ kind: "overview", label: "Programs" });
    expect(tree.groups.map((group) => group.id)).toEqual(["irs_soi", "census"]);
    expect(tree.groups[0].label).toBe("IRS Statistics of Income");
    expect(tree.groups.flatMap((group) => group.nodes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "program",
          label: "CTC",
          selection: { kind: "program", source: "irs_soi", value: "ctc" },
          metrics: expect.objectContaining({ nTargets: 4 }),
        }),
        expect.objectContaining({
          kind: "program",
          label: "Population",
          metrics: expect.objectContaining({ nTargets: 3 }),
        }),
      ]),
    );
  });

  test("renders geography first, then programs grouped by their source", () => {
    const overview = buildCalibrationTree(
      rows,
      state({ dimensions: [] }, "geography"),
    );

    expect(overview.currentLevel).toEqual({ kind: "geography", label: "Geography" });
    expect(overview.groups).toHaveLength(1);
    expect(overview.groups[0].label).toBe("Geography");
    expect(overview.groups[0].nodes.map((node) => [node.id, node.metrics.nTargets])).toEqual([
      ["CA", 8],
      ["United States", 2],
      ["NY", 1],
    ]);

    const programs = buildCalibrationTree(
      rows,
      state({ geography: "CA", dimensions: [] }, "geography"),
    );
    expect(programs.currentLevel).toEqual({ kind: "overview", label: "Programs" });
    expect(
      programs.groups.map((group) => [
        group.label,
        group.nodes.map((node) => [node.id, node.label]),
      ]),
    ).toEqual([
      [
        "IRS Statistics of Income",
        [
          ["taxable interest income", "Taxable interest income"],
          ["ctc", "CTC"],
        ],
      ],
      ["Census", [["population", "Population"]]],
    ]);
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
      { key: "bd_filing_status", label: "Filing status" },
      { key: "bd_income_band", label: "Income band" },
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

  test("uses only varying dimensions as breakdowns while retaining present dimension metadata", () => {
    const tree = buildCalibrationTree(
      rows,
      state({ source: "census", program: "population", geography: "CA", dimensions: [] }),
    );

    expect(tree.currentLevel).toEqual({ kind: "dimension", key: "bd_age", label: "Age" });
    expect(tree.groups[0].nodes.map((node) => node.label)).toEqual(["Adult", "Child"]);
    expect(tree.dimensionOrder).toEqual([
      { key: "bd_age", label: "Age" },
      { key: "bd_sex", label: "Sex" },
    ]);
  });

  test("automatically uses a new semantic dimension when it varies", () => {
    const dynamicRows = ["Employed", "Unemployed"].map((employmentStatus) =>
      target(`dynamic/${employmentStatus}`, {
        source: "test",
        variable: "dynamic",
        geography: "United States",
        target_dimensions: [
          {
            key: "bd_employment_status",
            label: "Employment Status",
            value: employmentStatus,
          },
        ],
      }),
    );

    const tree = buildCalibrationTree(
      dynamicRows,
      state({
        source: "test",
        program: "dynamic",
        geography: "United States",
        dimensions: [],
      }),
    );

    expect(tree.currentLevel).toEqual({
      kind: "dimension",
      key: "bd_employment_status",
      label: "Employment status",
    });
    expect(tree.groups[0].nodes.map((node) => node.label)).toEqual([
      "Employed",
      "Unemployed",
    ]);
    expect(tree.dimensionOrder).toEqual([
      { key: "bd_employment_status", label: "Employment status" },
    ]);
  });

  test("lets a new lower-cardinality dimension move ahead of an existing dimension", () => {
    const dynamicRows = ["Adult", "Child", "Senior"].flatMap((age) =>
      ["Employed", "Unemployed"].map((employmentStatus) =>
        target(`dynamic/${age}/${employmentStatus}`, {
          source: "test",
          variable: "dynamic",
          geography: "United States",
          target_dimensions: [
            { key: "bd_age", label: "Age Group", value: age },
            {
              key: "bd_employment_status",
              label: "Employment Status",
              value: employmentStatus,
            },
          ],
        }),
      ),
    );

    const tree = buildCalibrationTree(
      dynamicRows,
      state({
        source: "test",
        program: "dynamic",
        geography: "United States",
        dimensions: [],
      }),
    );

    expect(tree.dimensionOrder).toEqual([
      { key: "bd_employment_status", label: "Employment status" },
      { key: "bd_age", label: "Age group" },
    ]);
    expect(tree.currentLevel).toEqual({
      kind: "dimension",
      key: "bd_employment_status",
      label: "Employment status",
    });

    const employed = buildCalibrationTree(
      dynamicRows,
      state({
        source: "test",
        program: "dynamic",
        geography: "United States",
        dimensions: [
          {
            key: "bd_employment_status",
            label: "Employment status",
            value: "Employed",
          },
        ],
      }),
    );

    expect(employed.currentLevel).toEqual({
      kind: "dimension",
      key: "bd_age",
      label: "Age group",
    });
  });

  test("does not turn measurement concepts or anonymous legacy dimensions into breakdowns", () => {
    const measurementRows = [
      ["bd_measure", "Measure"],
      ["bd_amount", "Amount"],
      ["bd_count", "Count"],
      ["dim0", "Breakdown 1"],
    ].flatMap(([key, label]) =>
      ["First", "Second"].map((value) =>
        target(`measurement/${key}/${value}`, {
          source: "test",
          variable: "measurement",
          geography: "United States",
          target_dimensions: [{ key, label, value }],
        }),
      ),
    );

    const tree = buildCalibrationTree(
      measurementRows,
      state({
        source: "test",
        program: "measurement",
        geography: "United States",
        dimensions: [],
      }),
    );

    expect(tree.currentLevel).toEqual({ kind: "target", label: "Targets" });
    expect(tree.dimensionOrder).toEqual([]);
    expect(tree.groups[0].nodes).toHaveLength(8);
  });

  test("partitions sparse and ambiguous dimensions without missing buckets or duplicate targets", () => {
    const sparseRows = [
      target("sparse/age/adult", {
        source: "test",
        variable: "sparse",
        geography: "United States",
        target_dimensions: [
          { key: "bd_age", label: "Age", value: "Adult" },
          { key: "bd_program", label: "Program", value: "A" },
        ],
      }),
      target("sparse/age/senior", {
        source: "test",
        variable: "sparse",
        geography: "United States",
        target_dimensions: [
          { key: "bd_age", label: "Age", value: "Senior" },
          { key: "bd_program", label: "Program", value: "B" },
        ],
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
      ["bd_program", 2, 2],
      ["bd_age", 2, 2],
      ["targets", 2, 2],
    ]);
    expect(tree.groups.flatMap((group) => group.nodes).some((node) => node.id === "__missing__")).toBe(false);
    expect(tree.groups.reduce((sum, group) => sum + group.metrics.nTargets, 0)).toBe(6);
    expect(tree.groups.find((group) => group.id === "targets")?.nodes.map((node) => node.id)).toEqual([
      "sparse/ambiguous-income",
      "sparse/no-dimensions",
    ]);

    const programA = buildCalibrationTree(
      sparseRows,
      state({
        source: "test",
        program: "sparse",
        geography: "United States",
        dimensions: [{ key: "bd_program", label: "Program", value: "A" }],
      }),
    );
    expect(programA.groups.flatMap((group) => group.nodes).map((node) => node.id)).toEqual([
      "sparse/program/a",
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
      breakdown: "program",
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
