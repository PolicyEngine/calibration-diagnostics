import { expect, test } from "bun:test";

import { populaceTargetTreemap } from "./latest-artifact";

function row(
  source: string,
  variable_key: string,
  variable: string,
  measure: string | null,
  abs_relative_error: number | null,
  geography?: string | null,
) {
  return { source, variable_key, variable, measure, abs_relative_error, geography };
}

test("groups by source then variable_key and sums targets", () => {
  const data = populaceTargetTreemap(
    [
      row("irs_soi", "eitc · total", "eitc", "total", 0.05),
      row("irs_soi", "eitc · total", "eitc", "total", 0.07),
      row("irs_soi", "agi · total", "adjusted gross income", "total", 0.01),
      row("census_population", "population · count", "population", "count", 0.002),
    ],
    "rel-x",
  );

  expect(data.total_targets).toBe(4);
  const irs = data.groups.find((g) => g.source === "irs_soi");
  expect(irs?.n_targets).toBe(3);
  expect(irs?.children).toHaveLength(2);
  expect(data.groups[0].source).toBe("irs_soi"); // sorted by n_targets desc
  expect(data.groups.find((g) => g.source === "census_population")?.label).toBe(
    "Census population",
  );
});

test("loss winsorizes extreme outliers but median stays robust", () => {
  // One pathological near-zero target with a 50x relative error among well-fit ones.
  const data = populaceTargetTreemap(
    [
      row("irs_soi", "v · total", "v", "total", 0.02),
      row("irs_soi", "v · total", "v", "total", 0.02),
      row("irs_soi", "v · total", "v", "total", 0.04),
      row("irs_soi", "v · total", "v", "total", 50.0),
    ],
    "rel-x",
  );
  const leaf = data.groups[0].children[0];
  // Median ignores the outlier → ~3%.
  expect(leaf.median_abs_relative_error).toBeCloseTo(0.03, 6);
  // Mean is dragged up by the outlier.
  expect(leaf.mean_abs_relative_error).toBeGreaterThan(10);
  // Loss caps the outlier at 2.0 before squaring: 0.02^2*2 + 0.04^2 + 2^2 ≈ 4.0024.
  expect(leaf.loss).toBeCloseTo(0.0008 + 0.0016 + 4, 4);
});

test("targets without a relative error count but add no loss", () => {
  const data = populaceTargetTreemap(
    [
      row("ssa", "x · total", "x", "total", null),
      row("ssa", "x · total", "x", "total", 0.1),
    ],
    "rel-x",
  );
  const group = data.groups[0];
  expect(group.n_targets).toBe(2);
  expect(group.scored).toBe(1);
  expect(group.within_10pct).toBe(1);
});

test("program breakdown merges count and amount leaves", () => {
  const data = populaceTargetTreemap(
    [
      row("irs_soi", "irs_soi / taxable interest · total", "taxable interest", "total", 0.1),
      row("irs_soi", "irs_soi / taxable interest · count", "taxable interest returns", "count", 0.2),
      row("irs_soi", "irs_soi / eitc · count", "eitc", "count", 0.05),
    ],
    "rel-x",
    "program",
  );

  const irs = data.groups.find((g) => g.source === "irs_soi");
  expect(irs?.children).toHaveLength(2);
  const taxableInterest = irs?.children.find((leaf) => leaf.variable === "taxable interest");
  expect(taxableInterest?.key).toBe("irs_soi / taxable interest");
  expect(taxableInterest?.n_targets).toBe(2);
  expect(taxableInterest?.measure).toBe(null);
  expect(taxableInterest?.filters).toEqual({ program: "irs_soi / taxable interest" });
});

test("geography breakdown groups targets by geography leaves", () => {
  const data = populaceTargetTreemap(
    [
      row("irs_soi", "irs_soi / eitc · total", "eitc", "total", 0.1, "United States"),
      row("irs_soi", "irs_soi / eitc · total", "eitc", "total", 0.2, "CA"),
      row("irs_soi", "irs_soi / eitc · total", "eitc", "total", 0.3, null),
    ],
    "rel-x",
    "geography",
  );

  expect(data.groups).toHaveLength(1);
  expect(data.groups[0].source).toBe("geography");
  expect(data.groups[0].label).toBe("Geography");
  expect(data.groups[0].children.map((leaf) => leaf.key).sort()).toEqual([
    "CA",
    "N/A",
    "United States",
  ]);
  expect(data.groups[0].children.find((leaf) => leaf.key === "CA")?.filters).toEqual({
    geography: "CA",
  });
  expect(data.groups[0].children.find((leaf) => leaf.key === "N/A")?.filters).toEqual({
    missing_geography: true,
  });
});

test("treemap computes Huber error intensity", () => {
  const data = populaceTargetTreemap(
    [
      row("irs_soi", "irs_soi / v · total", "v", "total", 0.1),
      row("irs_soi", "irs_soi / v · total", "v", "total", 1.0),
      row("irs_soi", "irs_soi / v · total", "v", "total", 5.0),
      row("irs_soi", "irs_soi / v · total", "v", "total", null),
    ],
    "rel-x",
    "program",
  );

  const leaf = data.groups[0].children[0];
  // Huber(delta=2): 0.5*0.1^2, 0.5*1^2, 2*(5 - 1).
  const expectedHuberLoss = 0.005 + 0.5 + 8;
  expect(leaf.huber_loss).toBeCloseTo(expectedHuberLoss, 6);
  expect(leaf.huber_error_intensity).toBeCloseTo(
    Math.sqrt((2 * expectedHuberLoss) / 3),
    6,
  );
  expect(leaf.n_targets).toBe(4);
  expect(leaf.scored).toBe(3);
});
