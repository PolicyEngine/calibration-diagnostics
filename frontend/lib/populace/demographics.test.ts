import { expect, test } from "bun:test";

import { buildDemographics, buildDemographicsHistory } from "./demographics";

function raw(bands: object[], extra: object = {}) {
  return {
    schema_version: 1,
    period: 2024,
    measure: "person_weight",
    total_population: 360,
    benchmark_total_population: 334,
    benchmark_source: "Census",
    age_bands: bands,
    ...extra,
  };
}

const BANDS = [
  { label: "5–17", min_age: 5, max_age: 17, population: 86, share: 86 / 360, benchmark: 53, benchmark_share: 53 / 334, relative_error: (86 - 53) / 53 },
  { label: "18–24", min_age: 18, max_age: 24, population: 21, share: 21 / 360, benchmark: 30, benchmark_share: 30 / 334, relative_error: (21 - 30) / 30 },
  { label: "75+", min_age: 75, max_age: null, population: 25, share: 25 / 360, benchmark: 25, benchmark_share: 25 / 334, relative_error: 0 },
];

test("derives abs error and benchmark stats", () => {
  const d = buildDemographics(raw(BANDS), "rel-a");
  expect(d.bands).toHaveLength(3);
  const youth = d.bands.find((b) => b.label === "5–17")!;
  expect(youth.relative_error).toBeCloseTo((86 - 53) / 53, 6); // +62%
  expect(youth.abs_relative_error).toBeCloseTo((86 - 53) / 53, 6);
  expect(d.summary.n_benchmarked).toBe(3);
  expect(d.summary.max_abs_relative_error).toBeCloseTo((86 - 53) / 53, 6);
});

test("total vs benchmark is signed", () => {
  const d = buildDemographics(raw(BANDS), "rel-a");
  expect(d.summary.total_vs_benchmark).toBeCloseTo((360 - 334) / 334, 6); // +7.8%
});

test("bands without a benchmark are excluded from the fit summary", () => {
  const noBench = [{ label: "0–4", population: 20, share: 20 / 20, benchmark: null, relative_error: null }];
  const d = buildDemographics(raw(noBench, { total_population: 20, benchmark_total_population: null }), "rel-a");
  expect(d.summary.n_benchmarked).toBe(0);
  expect(d.summary.mean_abs_relative_error).toBeNull();
  expect(d.summary.total_vs_benchmark).toBeNull();
});

test("history is chronological with latest benchmark", () => {
  const hist = buildDemographicsHistory([
    { release_id: "r2", date: "20260201", demographics: buildDemographics(raw(BANDS), "r2") },
    { release_id: "r1", date: "20260101", demographics: buildDemographics(raw(BANDS), "r1") },
  ]);
  expect(hist.points.map((p) => p.release_id)).toEqual(["r1", "r2"]);
  expect(hist.benchmark_total_population).toBe(334);
  expect(hist.points[0].total_population).toBe(360);
});
