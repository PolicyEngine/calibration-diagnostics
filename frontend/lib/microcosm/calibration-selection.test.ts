import { expect, test } from "bun:test";

import {
  isStagingSelection,
  publishedReleaseSelection,
} from "./calibration-selection";

test("recognizes obsolete staging selectors without treating releases as staging", () => {
  expect(isStagingSelection("staging:uk-candidate")).toBe(true);
  expect(isStagingSelection("latest")).toBe(false);
  expect(isStagingSelection("")).toBe(false);
  expect(isStagingSelection(undefined)).toBe(false);
});

test("published-release pages discard staging candidate selectors", () => {
  expect(publishedReleaseSelection("staging:uk-candidate")).toBe("");
  expect(publishedReleaseSelection("populace-uk-2023-release")).toBe(
    "populace-uk-2023-release",
  );
  expect(publishedReleaseSelection(undefined)).toBe("");
});
