import { expect, test } from "bun:test";

import { populaceTargetTreemap } from "./latest-artifact";

function row(
  source: string,
  variable_key: string,
  variable: string,
  measure: string | null,
  abs_relative_error: number | null,
  level?: string,
) {
  return { source, variable_key, variable, measure, abs_relative_error, level };
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

test("levels lists the release's distinct levels even when level-filtered", () => {
  const rows = [
    row("irs_soi", "eitc · total", "eitc", "total", 0.05, "national"),
    row("irs_soi", "eitc · total", "eitc", "total", 0.07, "state"),
    row("census_population", "population · count", "population", "count", 0.002, "state"),
  ];

  expect(populaceTargetTreemap(rows, "rel-x").levels).toEqual(["national", "state"]);

  const filtered = populaceTargetTreemap(rows, "rel-x", "state");
  expect(filtered.total_targets).toBe(2);
  expect(filtered.levels).toEqual(["national", "state"]);

  // UK-style names parse to no level at all → no levels to filter by.
  const uk = populaceTargetTreemap(
    [row("ons", "population · count", "population", "count", 0.01, "")],
    "rel-x",
  );
  expect(uk.levels).toEqual([]);
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
