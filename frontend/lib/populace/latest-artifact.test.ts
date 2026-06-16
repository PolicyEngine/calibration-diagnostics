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

test("zero-target rows have null relative error, not a nonsense percentage", () => {
  // SOI cells that are genuinely $0 (e.g. the under-$1 AGI band) must not render
  // a $52B miss as "5191840415890%".
  const cal = calibration([
    { name: "nation/irs/real_estate_taxes/total/under 1@2024", target_name: "nation/irs/real_estate_taxes/total/under 1", target: 0, initial_estimate: 51.94e9, final_estimate: 51.92e9, relative_error: 51.92e9, within_tolerance: false },
  ]);
  const row = cal.rows[0];
  expect(row.relative_error).toBeNull(); // not the raw 51.92e9 the producer published
  expect(row.abs_relative_error).toBeNull();
  expect(row.target_is_zero).toBe(true);
  expect(row.abs_error).toBeCloseTo(51.92e9, 0); // the miss is still inspectable
  expect(row.direction).toBe("over");
});

// Dotted ledger names (irs_soi.ty2022.…) must canonicalise like slash names.
function dotted(name: string) {
  return { name: `${name}@2024`, target_name: name, target: 100, initial_estimate: 120, final_estimate: 110, relative_error: 0.1, within_tolerance: true };
}

test("dotted IRS names decompose into source/variable/measure/breakdown", () => {
  const cal = calibration([
    dotted("irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total"),
  ]);
  const row = cal.rows[0];
  expect(row.source).toBe("IRS SOI");
  expect(row.variable).toBe("eitc");
  expect(row.measure).toBe("amount"); // "…_total" -> amount
  expect(row.variable_key).toBe("IRS SOI / eitc · amount");
  expect(row.dims).toContain("0 children");
  expect(row.dims).toContain("AGI $25k–$30k");
});

test("dotted amount/count of the same variable split into two variables", () => {
  const cal = calibration([
    dotted("irs_soi.ty2022.historic_table_2.us.under_1.ctc_amount"),
    dotted("irs_soi.ty2022.historic_table_2.us.under_1.ctc_claims"),
  ]);
  const keys = new Set(cal.rows.map((r) => r.variable_key));
  expect(keys.has("IRS SOI / ctc · amount")).toBe(true);
  expect(keys.has("IRS SOI / ctc · count")).toBe(true); // claims -> count
  const ctc = cal.rows[0];
  expect(ctc.geography).toBe("United States");
});

test("a pure-measure leaf takes the descriptive token (jct, census)", () => {
  const cal = calibration([
    dotted("jct.tax_expenditures.cy2024.salt_deduction.revenue_loss"),
    dotted("census_stc.fy2024.individual_income_tax_collections.al.t40.collections"),
  ]);
  const jct = cal.rows.find((r) => r.source === "JCT")!;
  expect(jct.variable).toBe("salt deduction"); // not the generic "tax expenditures"
  const stc = cal.rows.find((r) => r.source === "Census STC")!;
  expect(stc.variable).toBe("individual income tax collections"); // skips the "t40" code
  expect(stc.geography).toBe("AL");
});

test("dotted EITC breakdowns facet by income band and children", () => {
  const cal = calibration([
    dotted("irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.25k_to_30k.eitc_total"),
    dotted("irs_soi.ty2022.table_2_5.eitc_by_agi_children.no_qualifying_children.30k_to_35k.eitc_total"),
    dotted("irs_soi.ty2022.table_2_5.eitc_by_agi_children.one_qualifying_child.25k_to_30k.eitc_total"),
  ]);
  const result = page("?variable=IRS%20SOI%20%2F%20eitc%20%C2%B7%20amount", cal);
  const labels = result.dimensions.map((d) => d.label);
  expect(labels).toContain("Income band");
  expect(labels).toContain("Children");
});

test("variable comparison aligns the slash and dotted naming schemes", () => {
  // A uses slash names, B uses dotted names; no individual targets match, but
  // the shared variables (JCT SALT, IRS AGI) must align at the variable level.
  const a = calibration(
    [
      { name: "nation/jct/salt_deduction_expenditure@2024", target_name: "nation/jct/salt_deduction_expenditure", target: 100, final_estimate: 100, relative_error: 0, within_tolerance: true },
      { name: "nation/irs/adjusted gross income/total/AGI in 200k-500k/taxable/All@2024", target_name: "nation/irs/adjusted gross income/total/AGI in 200k-500k/taxable/All", target: 100, final_estimate: 95, relative_error: -0.05, within_tolerance: true },
    ],
    "rel-a",
  );
  const b = calibration(
    [
      dotted("jct.tax_expenditures.cy2024.salt_deduction.revenue_loss"),
      dotted("irs_soi.ty2022.historic_table_2.us.all.adjusted_gross_income"),
    ],
    "rel-b",
  );
  const cmp = buildComparison(a, b);
  expect(cmp.summary.common).toBe(0); // raw names share nothing
  const vc = cmp.variable_comparison ?? [];
  const salt = vc.find((r) => r.key === "jct/salt deduction");
  expect(salt?.a.n_targets).toBe(1);
  expect(salt?.b.n_targets).toBe(1);
  expect(vc.find((r) => r.key === "irs/adjusted gross income")).toBeTruthy();
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
