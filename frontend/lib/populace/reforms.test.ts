import { expect, test } from "bun:test";

import { buildReformHistory, buildReformValidation } from "./reforms";

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
