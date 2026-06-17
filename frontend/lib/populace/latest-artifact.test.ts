import { expect, test } from "bun:test";

import {
  buildCalibration,
  buildComparison,
  latestPopulaceCalibrationSummary,
  latestPopulaceTargetDiagnosticsPage,
  type Calibration,
} from "./latest-artifact";

// A v2-shaped target: AGI bracket × return type × filing status, with @period.
function agiTarget(band: string, ret: string, filing: string, rel: number) {
  return {
    name: `nation/irs/adjusted gross income/total/${band}/${ret}/${filing}@2024`,
    target_name: `nation/irs/adjusted gross income/total/${band}/${ret}/${filing}`,
    period: 2024,
    entity: "household",
    aggregation: "sum",
    measure: { kind: "column", name: "adjusted_gross_income" },
    source: "IRS SOI Table 1.1",
    target: 100,
    initial_estimate: 140,
    final_estimate: 100 * (1 + rel),
    relative_error: rel,
    within_tolerance: Math.abs(rel) <= 0.1,
  };
}

function calibration(targets: object[], releaseId = "rel-a"): Calibration {
  return buildCalibration({ targets, final_loss: 0.02, fraction_within_10pct: 0.9 }, releaseId);
}

const SAMPLE = calibration([
  agiTarget("AGI in 200k-500k", "taxable", "All", -0.086),
  agiTarget("AGI in 200k-500k", "taxable", "Married Filing Jointly", -0.102),
  agiTarget("AGI in 30k-40k", "taxable", "All", 0.236),
  { name: "US06/snap-cost", target: 100, initial_estimate: 90, final_estimate: 99, relative_error: -0.01, within_tolerance: true },
]);

function page(url: string, cal = SAMPLE) {
  return latestPopulaceTargetDiagnosticsPage(`http://x/api/populace/target-diagnostics${url}`, cal);
}

test("v2 metadata and parsing survive enrichment", () => {
  const row = SAMPLE.rows[0];
  expect(row.variable_key).toBe("irs / adjusted gross income · total");
  expect(row.variable).toBe("adjusted gross income"); // @2024 stripped via target_name
  expect(row.geography).toBe("United States");
  expect(row.entity).toBe("household");
  expect(row.aggregation).toBe("sum");
  expect(row.period).toBe(2024);
  expect(row.source_citation).toBe("IRS SOI Table 1.1");
});

test("FIPS admin target collapses to a measure family", () => {
  const snap = SAMPLE.rows.find((r) => r.variable === "snap-cost")!;
  expect(snap.geography).toBe("CA");
  expect(snap.source).toBe("admin");
  expect(snap.family).toBe("snap-cost");
});

test("variable filter isolates a variable's breakdowns", () => {
  const result = page("?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total");
  expect(result.filtered_total).toBe(3);
  for (const row of result.targets) expect(row.variable_key).toBe("irs / adjusted gross income · total");
});

test("dimensions are the axes that vary; constants drop", () => {
  const result = page("?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total");
  const labels = result.dimensions.map((d) => d.label);
  expect(labels).toContain("Income band");
  expect(labels).toContain("Filing status");
  expect(labels).not.toContain("Return type"); // all "taxable" -> constant
});

test("facet filter narrows to a single breakdown", () => {
  const income = page("?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total").dimensions.find(
    (d) => d.label === "Income band",
  )!;
  const result = page(
    `?variable=irs%20%2F%20adjusted%20gross%20income%20%C2%B7%20total&facet=${income.key}:AGI in 30k-40k`,
  );
  expect(result.filtered_total).toBe(1);
  expect(result.targets[0].dims).toContain("AGI in 30k-40k");
});

test("calibration summary reports per-family fit", () => {
  const summary = latestPopulaceCalibrationSummary(SAMPLE);
  expect(summary.total_targets).toBe(4);
  expect(summary.family_fit.length).toBeGreaterThan(0);
});

test("comparison matches on base_name across the @period boundary", () => {
  // B drops one target, changes one fit, adds a new one.
  const b = calibration(
    [
      agiTarget("AGI in 200k-500k", "taxable", "All", -0.02), // improved (|−0.02| < |−0.086|)
      agiTarget("AGI in 30k-40k", "taxable", "All", 0.30), // regressed
      { name: "nation/cbo/individual_income_tax@2024", target_name: "nation/cbo/individual_income_tax", target: 1, initial_estimate: 1, final_estimate: 1, relative_error: 0, within_tolerance: true },
    ],
    "rel-b",
  );
  const cmp = buildComparison(SAMPLE, b);
  expect(cmp.summary.common).toBe(2);
  expect(cmp.summary.improved).toBe(1);
  expect(cmp.summary.regressed).toBe(1);
  expect(cmp.summary.added).toBe(1); // cbo income tax, only in B
  expect(cmp.summary.removed).toBe(2); // the MFJ AGI row and snap-cost, only in A
  expect(cmp.summary.losses_comparable).toBe(false);
});

test("dotted ledger target names use metadata for readable fields", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount",
      target: 0,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: 90,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "real_estate_taxes",
        source_measure_id: "real_estate_taxes_amount",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_layout_groupby_value_id: "under_1",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].source).toBe("irs_soi");
  expect(cal.rows[0].variable).toBe("real estate taxes");
  expect(cal.rows[0].measure).toBe("total");
  expect(cal.rows[0].geography).toBe("United States");
  expect(cal.rows[0].breakdown).toBe("under 1 · All");
  expect(cal.rows[0].error_kind).toBe("absolute");
  expect(cal.rows[0].initial_error).toBe(100);
  expect(cal.rows[0].final_error).toBe(90);
  expect(cal.rows[0].initial_relative_error).toBe(null);
  expect(cal.rows[0].abs_relative_error).toBe(null);
});

test("source measure details become breakdown dimensions", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US04",
        ledger_layout_groupby_value_id: "az",
        filing_status: "All",
      },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_no_children_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_eitc.az.az.eitc_no_children_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_no_children_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US04",
        ledger_layout_groupby_value_id: "az",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].variable).toBe("eitc");
  expect(cal.rows[0].measure).toBe("total");
  expect(cal.rows[0].breakdown).toBe("all qualifying children · All");
  expect(cal.rows[0].dims).toEqual(["all qualifying children", "All"]);
  expect(cal.rows[0].variable_key).toBe("irs_soi / eitc · total");
  expect(cal.rows[1].breakdown).toBe("no qualifying children · All");
  const result = latestPopulaceTargetDiagnosticsPage(
    "http://x/api/populace/target-diagnostics?variable=irs_soi%20%2F%20eitc%20%C2%B7%20total",
    cal,
  );
  expect(result.dimensions.map((dim) => dim.label)).toContain("Qualifying children");
});

test("metadata dimensions skip geography repeated as layout breakdown", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.historic_table_2.state_broad.az.all.ctc_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_broad.az.all.ctc_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "ctc",
        source_measure_id: "ctc_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US04",
        ledger_layout_record_set_id: "irs_soi.ty2022.historic_table_2.state_broad.az",
        ledger_layout_groupby_dimension: "state",
        ledger_layout_groupby_value_id: "all",
        ledger_filter_income_range: "all",
        filing_status: "All",
      },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.state_broad.ca.all.ctc_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.state_broad.ca.all.ctc_amount",
      target: 100,
      initial_estimate: 100,
      final_estimate: 90,
      relative_error: -0.1,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "ctc",
        source_measure_id: "ctc_amount",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US06",
        ledger_layout_record_set_id: "irs_soi.ty2022.historic_table_2.state_broad.ca",
        ledger_layout_groupby_dimension: "state",
        ledger_layout_groupby_value_id: "all",
        ledger_filter_income_range: "all",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].geography).toBe("AZ");
  expect(cal.rows[0].breakdown).toBe("All · All");
  const result = latestPopulaceTargetDiagnosticsPage(
    "http://x/api/populace/target-diagnostics?variable=irs_soi%20%2F%20ctc%20%C2%B7%20total",
    cal,
  );
  expect(result.dimensions.map((dim) => dim.label)).toEqual(["Geography"]);
});

test("EITC table 2.5 child groups come from record set ids", () => {
  const cal = calibration([
    {
      name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total@2024",
      target_name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total",
      target: 535000,
      initial_estimate: 1995625464.431402,
      final_estimate: 910866264.4027674,
      relative_error: 1701.5537652388175,
      filter: null,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_total",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id:
          "irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children",
        ledger_layout_groupby_value_id: "25k_to_30k",
        filing_status: "All",
      },
    },
    {
      name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.one_qualifying_child.25k_to_30k.eitc_total@2024",
      target_name: "irs_soi.ty2022.table_2_5.eitc_by_agi_children.one_qualifying_child.25k_to_30k.eitc_total",
      target: 2717219000,
      initial_estimate: 1995625464.431402,
      final_estimate: 910866264.4027674,
      relative_error: -0.6647799590674262,
      filter: null,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "eitc",
        source_measure_id: "eitc_total",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id:
          "irs_soi.ty2022.table_2_5.eitc_by_agi_children.one_qualifying_child",
        ledger_layout_groupby_value_id: "25k_to_30k",
        filing_status: "All",
      },
    },
  ]);
  expect(cal.rows[0].breakdown).toBe("25k to 30k · no qualifying children · All");
  expect(cal.rows[0].dims).toEqual(["25k to 30k", "no qualifying children", "All"]);
  expect(cal.rows[0].estimate_warning).toContain("no compiled filter");
});

test("repeated unfiltered sibling estimates get generic scope warnings", () => {
  const cal = calibration([
    {
      name: "source.example.slice_a.under_50.amount@2024",
      target_name: "source.example.slice_a.under_50.amount",
      target: 10,
      initial_estimate: 100,
      final_estimate: 80,
      relative_error: 7,
      filter: null,
      registry: { family: "example" },
      metadata: {
        variable: "example",
        source_measure_id: "amount",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id: "source.example.slice_a",
        ledger_layout_groupby_dimension: "age",
        ledger_layout_groupby_value_id: "under_50",
        ledger_layout_measure_id: "amount",
      },
    },
    {
      name: "source.example.slice_b.under_50.amount@2024",
      target_name: "source.example.slice_b.under_50.amount",
      target: 20,
      initial_estimate: 100,
      final_estimate: 80,
      relative_error: 3,
      filter: null,
      registry: { family: "example" },
      metadata: {
        variable: "example",
        source_measure_id: "amount",
        ledger_geography_id: "0100000US",
        ledger_layout_record_set_id: "source.example.slice_b",
        ledger_layout_groupby_dimension: "age",
        ledger_layout_groupby_value_id: "under_50",
        ledger_layout_measure_id: "amount",
      },
    },
  ]);
  expect(cal.rows[0].estimate_warning).toContain("sibling slices share the same estimate");
  expect(cal.rows[1].estimate_warning).toContain("sibling slices share the same estimate");
});

test("zero targets compare as absolute misses, not relative-error movers", () => {
  const target = {
    name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount@2024",
    target_name: "irs_soi.ty2022.historic_table_2.us.under_1.real_estate_taxes_amount",
    target: 0,
    registry: { family: "irs_soi" },
    metadata: {
      variable: "real_estate_taxes",
      source_measure_id: "real_estate_taxes_amount",
      ledger_geography_level: "country",
      ledger_geography_id: "0100000US",
      ledger_layout_groupby_value_id: "under_1",
      filing_status: "All",
    },
  };
  const a = calibration([{ ...target, final_estimate: 100, relative_error: 100 }], "a");
  const b = calibration([{ ...target, final_estimate: 90, relative_error: 90 }], "b");
  const cmp = buildComparison(a, b);
  expect(cmp.summary.improved).toBe(0);
  expect(cmp.rows[0].error_kind).toBe("absolute");
  expect(cmp.rows[0].a_error).toBe(100);
  expect(cmp.rows[0].b_error).toBe(90);
  expect(cmp.rows[0].abs_rel_delta).toBe(null);
});

test("count and total measures split into distinct variables", () => {
  const cal = calibration([
    { name: "nation/irs/capital gains gross/total/AGI in 1m-inf/taxable/All@2024", target_name: "nation/irs/capital gains gross/total/AGI in 1m-inf/taxable/All", target: 100, initial_estimate: 90, final_estimate: 100, relative_error: 0, within_tolerance: true },
    { name: "nation/irs/capital gains gross/count/AGI in 1m-inf/taxable/All@2024", target_name: "nation/irs/capital gains gross/count/AGI in 1m-inf/taxable/All", target: 10, initial_estimate: 9, final_estimate: 10, relative_error: 0, within_tolerance: true },
  ]);
  const keys = new Set(cal.rows.map((r) => r.variable_key));
  expect(keys.has("irs / capital gains gross · total")).toBe(true);
  expect(keys.has("irs / capital gains gross · count")).toBe(true);
  expect(cal.rows.find((r) => r.measure === "count")).toBeTruthy();
  expect(cal.rows.find((r) => r.measure === "total")).toBeTruthy();
});
