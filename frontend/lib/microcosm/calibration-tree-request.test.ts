import { expect, test } from "bun:test";

import { calibrationTreeRequestState } from "./calibration-tree-request";

test("parses supported comparison-fit filters and rejects unknown values", () => {
  const state = calibrationTreeRequestState(new URLSearchParams([
    ["comparison_fit", "improved"],
    ["comparison_fit", "not_applicable"],
    ["comparison_fit", "unknown"],
  ]));

  expect(state.filters.comparisonFits).toEqual([
    "improved",
    "not_applicable",
  ]);
});
