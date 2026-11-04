import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { categoryLevels } from "@policyengine/calibration-tree/latest-artifact";

import { statisticGroupCount, statisticGroupKey } from "./statistic-groups";

const row = (variable: string, measure: string, level: string | null, levels: string[]) => ({
  source: "ed_fsa",
  variable,
  measure,
  level,
  levels,
});

describe("statistic groups", () => {
  test("a category at one level keys on that level, as before", () => {
    expect(statisticGroupKey(row("snap", "total", "state", ["state"]))).toBe(
      ["ed_fsa", "state", "snap"].join("::"),
    );
  });

  // A category at two levels has no single level: its key holds both, so
  // its measures share one statistic whatever their first rows' levels.
  test("a category at two levels keys on both", () => {
    const total = row("ed_fsa.federal_student_loan_balance", "total", null, ["country", "state"]);
    const count = row("ed_fsa.federal_student_loan_balance", "count", null, ["country", "state"]);
    expect(statisticGroupKey(total)).toBe(
      ["ed_fsa", "country+state", "ed_fsa.federal_student_loan_balance"].join("::"),
    );
    expect(statisticGroupCount([total, count])).toBe(1);
    expect(
      statisticGroupCount([
        total,
        row("ed_fsa.parent_plus_loan_balance", "total", "country", ["country"]),
        row("ed_fsa.parent_plus_loan_balance", "count", "country", ["country"]),
        row("snap", "total", "state", ["state"]),
        row("snap", "total", "country", ["country"]),
      ]),
    ).toBe(4);
  });

  test("a row from a server without levels falls back to its level", () => {
    expect(
      statisticGroupKey({ source: "irs_soi", variable: "agi", level: "country" }),
    ).toBe(["irs_soi", "country", "agi"].join("::"));
  });
});

// Generated-input checks from the independent review of #277's scoped run
// (fast-check, seed 277, 20,000 runs each), each within the scope its
// comment states.
describe("statistic group keys, on generated input", () => {
  const params = { numRuns: 20_000, seed: 277, endOnFailure: false };
  const token = fc.oneof(
    fc.constantFrom("ed_fsa", "irs_soi", "snap", "a::b", "x+y"),
    fc.string({ maxLength: 6 }),
  );

  test("the key equals the old key for every single-level row", () => {
    fc.assert(
      fc.property(token, fc.oneof(fc.constant(""), token), token, (source, level, variable) => {
        const levels = level ? [level] : [];
        return (
          statisticGroupKey({ source, variable, level, levels }) ===
          [source, level, variable].join("::")
        );
      }),
      params,
    );
  });

  // The old key was [source, the first row's level, variable]
  // (latest-artifact.ts:1526 at 2306113). Out of scope: a category whose
  // first row has no level, which keys on its other rows' level now.
  test("for a category at one level, the key equals the key the first row gave it", () => {
    const levelValue = fc.oneof(
      fc.constantFrom("country", "state", "national", "region", "", null, undefined, " "),
      fc.string({ maxLength: 4 }),
      fc.integer({ min: -2, max: 2 }),
    );
    fc.assert(
      fc.property(
        fc.array(fc.record({ level: levelValue }), { minLength: 1, maxLength: 6 }),
        (rows) => {
          const shown = categoryLevels(rows as never, "");
          fc.pre(shown.levels.length <= 1);
          fc.pre(String(rows[0].level ?? "") !== "" || shown.levels.length === 0);
          const oldKey = ["s", String(rows[0].level ?? ""), "v"].join("::");
          return statisticGroupKey({ source: "s", variable: "v", ...shown }) === oldKey;
        },
      ),
      params,
    );
  });
});
