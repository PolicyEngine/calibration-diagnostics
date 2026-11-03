import { describe, expect, test } from "bun:test";

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
