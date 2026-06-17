import { expect, test } from "bun:test";

import {
  buildCalibration,
  buildComparison,
  latestPopulaceCalibrationHighlights,
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

test("income band facets sort total first, then descending numeric bands", () => {
  const rows = ["total", "under_1", "1_to_10k", "50k_plus", "500k_to_1m", "1m_plus"]
    .map((band) => ({
      name: `irs_soi.ty2022.historic_table_2.us.${band}.adjusted_gross_income@2024`,
      target_name: `irs_soi.ty2022.historic_table_2.us.${band}.adjusted_gross_income`,
      target: 100,
      initial_estimate: 100,
      final_estimate: 100,
      relative_error: 0,
      registry: { family: "irs_soi" },
      metadata: {
        variable: "adjusted_gross_income",
        source_measure_id: "adjusted_gross_income",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
        ledger_measure_unit: "usd",
        ledger_layout_groupby_dimension: "us:statutes/26/62#adjusted_gross_income",
        ledger_layout_groupby_value_id: band,
        ledger_filter_income_range: band === "total" ? "all" : band,
        filing_status: "All",
      },
    }));
  const cal = calibration(rows);
  const result = latestPopulaceTargetDiagnosticsPage(
    "http://x/api/populace/target-diagnostics?variable=irs_soi%20%2F%20adjusted%20gross%20income%20%C2%B7%20total",
    cal,
  );
  const incomeBand = result.dimensions.find((dim) => dim.label === "Income band");

  expect(incomeBand?.values).toEqual([
    "Total",
    "1m plus",
    "500k to 1m",
    "50k plus",
    "1 to 10k",
    "under 1",
  ]);
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
  expect(summary.included_target_count).toBe(4);
  expect(summary.family_fit.length).toBeGreaterThan(0);
});

test("release highlights split bounded percent fit from absolute miss magnitude", () => {
  const cal = calibration([
    {
      name: "source.us.total.relative-bounded@2024",
      target_name: "source.us.total.relative-bounded",
      target: 100,
      initial_estimate: 1000,
      final_estimate: 900,
      relative_error: 8,
      within_tolerance: false,
    },
    {
      name: "source.us.total.relative-extreme@2024",
      target_name: "source.us.total.relative-extreme",
      target: 1,
      initial_estimate: 120,
      final_estimate: 100,
      relative_error: 99,
      within_tolerance: false,
    },
    {
      name: "source.us.total.absolute-large@2024",
      target_name: "source.us.total.absolute-large",
      target: 1_000_000_000,
      initial_estimate: 1_600_000_000,
      final_estimate: 1_400_000_000,
      relative_error: 0.4,
      within_tolerance: false,
    },
  ]);
  const highlights = latestPopulaceCalibrationHighlights(cal, 10);

  expect(highlights.extreme_relative_outlier_count).toBe(1);
  expect(highlights.worst_bounded_relative_fit.map((row) => row.base_name)).toContain(
    "source.us.total.relative-bounded",
  );
  expect(highlights.worst_bounded_relative_fit.map((row) => row.base_name)).not.toContain(
    "source.us.total.relative-extreme",
  );
  expect(highlights.extreme_relative_outliers[0].base_name).toBe(
    "source.us.total.relative-extreme",
  );
  expect(highlights.largest_absolute_misses[0].base_name).toBe(
    "source.us.total.absolute-large",
  );
  expect(highlights.largest_absolute_misses[0].abs_final_miss).toBe(400_000_000);
  expect(highlights.biggest_absolute_improvements[0].absolute_improvement).toBe(200_000_000);
});

test("calibration inclusion status uses skipped and dropped metadata", () => {
  const cal = buildCalibration(
    {
      targets: [
        { name: "included@2024", target: 1, initial_estimate: 1, final_estimate: 1 },
        { name: "skipped@2024", target_name: "skipped", target: 1 },
        { name: "dropped@2024", target_name: "dropped", target: 1 },
      ],
      skipped: [{ name: "skipped", reason: "No support." }],
    },
    "rel-a",
    null,
    {
      gates: {
        target_compilation: {
          declared_targets: 3,
          compiled_candidate_targets: 2,
          dropped_target_names: ["dropped"],
        },
      },
    },
  );

  expect(cal.included_target_count).toBe(1);
  expect(cal.dropped_target_names).toEqual(["dropped"]);
  expect(cal.rows.map((row) => row.calibration_status)).toEqual([
    "included",
    "skipped",
    "not_materialized",
  ]);
  const page = latestPopulaceTargetDiagnosticsPage(
    "http://x/api/populace/target-diagnostics",
    cal,
  );
  expect(page.summary.included_target_count).toBe(1);
  expect(page.summary.skipped_target_count).toBe(1);
  expect(page.summary.dropped_target_count).toBe(1);
  expect(page.targets[1].calibration_status_reason).toBe("No support.");
});

test("healthcare scope includes ACA, Medicaid, Medicare, and PTC targets", () => {
  const cal = calibration([
    {
      name: "cms_aca.oep2024.state_marketplace.ca.aptc_recipients@2024",
      target_name: "cms_aca.oep2024.state_marketplace.ca.aptc_recipients",
      target: 100,
      initial_estimate: 50,
      final_estimate: 80,
      relative_error: -0.2,
      registry: { family: "cms_aca" },
      metadata: {
        target_role: "aca_ptc_recipients",
        source_measure_id: "aptc_recipients",
        ledger_geography_level: "state",
        ledger_geography_id: "0400000US06",
      },
    },
    {
      name: "US06/cms_medicaid/total_medicaid_enrollment@2024",
      target: 100,
      initial_estimate: 90,
      final_estimate: 95,
      relative_error: -0.05,
      metadata: { target_role: "medicaid_enrollment" },
    },
    {
      name: "nation/cms_medicare/part_b_premium_income@2024",
      target: 100,
      initial_estimate: 100,
      final_estimate: 101,
      relative_error: 0.01,
      metadata: { target_role: "medicare_part_b_premium_total" },
    },
    {
      name: "irs_soi.ty2022.historic_table_2.us.all.premium_tax_credit_amount@2024",
      target_name: "irs_soi.ty2022.historic_table_2.us.all.premium_tax_credit_amount",
      target: 100,
      initial_estimate: 60,
      final_estimate: 70,
      relative_error: -0.3,
      registry: { family: "irs_soi" },
      metadata: {
        target_role: "aca_spending",
        source_measure_id: "premium_tax_credit_amount",
        ledger_geography_level: "country",
        ledger_geography_id: "0100000US",
      },
    },
    agiTarget("AGI in 30k-40k", "taxable", "All", 0.01),
  ]);

  const result = latestPopulaceTargetDiagnosticsPage(
    "http://x/api/populace/target-diagnostics?scope=healthcare",
    cal,
  );

  expect(result.total_targets).toBe(4);
  expect(result.filtered_total).toBe(4);
  expect(result.summary.fraction_within_10pct).toBe(0.5);
  expect(result.targets.map((row) => row.name)).not.toContain(
    "nation/irs/adjusted gross income/total/AGI in 30k-40k/taxable/All@2024",
  );
  expect(result.variables.map((row) => row.source)).toContain("cms_aca");
  expect(result.variables.map((row) => row.source)).toContain("irs_soi");
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
  expect(cmp.variables[0].variable_key).toBe("irs / adjusted gross income · total");
  expect(cmp.variables[0].common_targets).toBe(2);
  expect(cmp.variables[0].relative_targets).toBe(2);
  expect(cmp.variables[0].improved).toBe(1);
  expect(cmp.variables[0].regressed).toBe(1);
  expect(Array.isArray(cmp.rows[0].target_dimensions)).toBe(true);
});

test("new target loss weighting metadata marks loss as normalized", () => {
  const normalized = buildCalibration(
    {
      targets: [],
      initial_loss: 0.42,
      final_loss: 0.39,
      options: {
        target_loss_scales: { wages: 1 },
        target_loss_weights: { wages: 1 },
      },
    },
    "normalized-release",
  );
  const raw = buildCalibration(
    { targets: [], initial_loss: 752_000_000_000, final_loss: 751_000_000_000 },
    "raw-release",
  );

  expect(latestPopulaceCalibrationSummary(normalized).loss_kind).toBe("normalized_target_loss");
  expect(latestPopulaceCalibrationSummary(raw).loss_kind).toBe("raw_optimizer_objective");
  expect(buildComparison(raw, normalized).summary.losses_comparable).toBe(false);
  expect(buildComparison(raw, normalized).summary.loss_kind).toBe("mixed");
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
  expect(cal.rows[0].estimate_warning).toContain("compiled model filter");
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
