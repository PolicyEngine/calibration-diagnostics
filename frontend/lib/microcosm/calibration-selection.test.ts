import { expect, test } from "bun:test";

import {
  isStagingSelection,
  stagingRunIdOf,
  stagingSelectionFor,
} from "./calibration-selection";

test("a staging selection carries its run id behind the prefix", () => {
  const selection = stagingSelectionFor("uk-frs-calibration-attempt-20260920T170811Z-ce339e7c");
  expect(selection).toBe("staging:uk-frs-calibration-attempt-20260920T170811Z-ce339e7c");
  expect(isStagingSelection(selection)).toBe(true);
  expect(stagingRunIdOf(selection)).toBe("uk-frs-calibration-attempt-20260920T170811Z-ce339e7c");
});

test("release selections and empty candidates are not staging selections", () => {
  expect(isStagingSelection("latest")).toBe(false);
  expect(isStagingSelection("")).toBe(false);
  expect(isStagingSelection(undefined)).toBe(false);
  expect(stagingRunIdOf("populace-uk-2023-dd68c73")).toBeNull();
  // A bare prefix names no run; callers fall through to the release-id guard.
  expect(isStagingSelection("staging:")).toBe(true);
  expect(stagingRunIdOf("staging:")).toBeNull();
  expect(stagingRunIdOf("staging:   ")).toBeNull();
});
