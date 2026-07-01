import { expect, test } from "bun:test";

import { buildReformHistory, buildReformValidation } from "./reforms";
import { REFORM_OVERRIDES } from "./reform-overrides";

test("FY2027 full-year benchmark and its relative error are parsed", () => {
  const built = buildReformValidation(
    {
      release_id: "r",
      reforms: [
        {
          id: "obbba_salt_limit",
          name: "SALT",
          in_sample: false,
          jct: { score: 31617000000, score_fy2027: 79250000000 },
          populace: { budget_effect: 64000000000 },
        },
      ],
    },
    "r",
    null,
  );
  expect(built.available).toBe(true);
  if (!built.available) return;
  const row = built.rows[0];
  expect(row.jct_score_fy2027).toBe(79250000000);
  // +102% vs FY2026, but ~-19% vs the full-year FY2027 figure.
  expect(row.relative_error).toBeGreaterThan(0.9);
  expect(row.relative_error_fy2027).toBeLessThan(0);
  expect(Math.abs(row.relative_error_fy2027!)).toBeLessThan(0.25);
});

test("committed reform overrides carry simulated out-of-sample estimates", () => {
  const entries = Object.entries(REFORM_OVERRIDES);
  expect(entries.length).toBeGreaterThan(0);
  for (const [releaseId, payload] of entries) {
    const built = buildReformValidation(payload as Record<string, unknown>, releaseId, null);
    expect(built.available).toBe(true);
    if (!built.available) continue;
    const outOfSample = built.rows.filter((r) => !r.in_sample);
    expect(outOfSample.length).toBeGreaterThan(0);
    // The whole point of the backfill: every out-of-sample row is now scored.
    expect(outOfSample.every((r) => r.populace_estimate !== null)).toBe(true);
  }
});

function raw(reforms: object[], releaseId = "rel-a") {
  return { schema_version: 1, release_id: releaseId, scoring_window: "FY2025-2034", reforms };
}

const obbba = {
  id: "obbba",
  name: "One Big Beautiful Bill Act",
  category: "OBBBA",
  in_sample: false,
  jct: { score: -4000, score_type: "conventional", window: "FY2025-2034", source: "JCX-29-25" },
  populace: { budget_effect: -3600, window: "FY2025-2034" },
};
const salt = {
  id: "obbba_salt",
  name: "OBBBA — SALT cap to $40k",
  category: "OBBBA",
  in_sample: false,
  jct: { score: -1000, source: "JCX-30-25" },
  populace: { budget_effect: -1050 },
};

test("derives populace-vs-JCT error per reform", () => {
  const v = buildReformValidation(raw([obbba, salt]), "rel-a");
  const row = v.rows.find((r) => r.id === "obbba")!;
  expect(row.abs_error).toBe(400); // −3600 − (−4000)
  expect(row.relative_error).toBeCloseTo(0.1, 6); // 400 / 4000
  expect(row.abs_relative_error).toBeCloseTo(0.1, 6);
  expect(row.within_10pct).toBe(true);
  expect(row.direction).toBe("over"); // populace less negative than JCT
});

test("summary counts only scored reforms and averages |error|", () => {
  const unscored = { id: "x", name: "No populace estimate", in_sample: false, jct: { score: -500 } };
  const v = buildReformValidation(raw([obbba, salt, unscored]), "rel-a");
  expect(v.summary.n_reforms).toBe(3);
  expect(v.summary.n_scored).toBe(2); // unscored has no populace estimate
  expect(v.summary.within_10pct).toBe(2); // obbba 10%, salt 5%
  expect(v.summary.mean_abs_relative_error).toBeCloseTo((0.1 + 0.05) / 2, 6);
});

test("summary isolates the out-of-sample reforms from in-sample targets", () => {
  const inSample = {
    id: "jct_mortgage",
    name: "Mortgage interest deduction",
    in_sample: true,
    jct: { score: 1000 },
    populace: { budget_effect: 2000 }, // |error| 100% — but in-sample
  };
  const v = buildReformValidation(raw([obbba, salt, inSample]), "rel-a");
  expect(v.summary.n_out_of_sample).toBe(2); // obbba + salt
  expect(v.summary.n_out_of_sample_scored).toBe(2);
  expect(v.summary.out_of_sample_within_10pct).toBe(2);
  // out-of-sample mean excludes the 100% in-sample miss.
  expect(v.summary.out_of_sample_mean_abs_relative_error).toBeCloseTo((0.1 + 0.05) / 2, 6);
});

test("run-over-run series is chronological with an improvement delta", () => {
  const older = {
    release_id: "r1",
    date: "20260101",
    validation: buildReformValidation(
      raw([{ ...obbba, populace: { budget_effect: -3000 } }], "r1"),
      "r1",
    ), // |error| = 1000/4000 = 0.25
  };
  const newer = {
    release_id: "r2",
    date: "20260201",
    validation: buildReformValidation(raw([obbba], "r2"), "r2"), // |error| = 0.10
  };
  const hist = buildReformHistory([newer, older]); // intentionally out of order
  const series = hist.reforms.find((r) => r.id === "obbba")!;
  expect(series.points.map((p) => p.release_id)).toEqual(["r1", "r2"]); // sorted oldest→newest
  expect(series.latest_abs_relative_error).toBeCloseTo(0.1, 6);
  expect(series.delta).toBeCloseTo(0.1 - 0.25, 6); // negative = improved
  expect(hist.releases.map((r) => r.release_id)).toEqual(["r1", "r2"]);
});

test("zero JCT score does not divide by zero", () => {
  const v = buildReformValidation(
    raw([{ id: "z", name: "Zero-cost", jct: { score: 0 }, populace: { budget_effect: 25 } }]),
    "rel-a",
  );
  const row = v.rows[0];
  expect(row.abs_error).toBe(25);
  expect(Number.isFinite(row.relative_error!)).toBe(true);
});
