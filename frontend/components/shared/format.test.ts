import { expect, test } from "bun:test";

import {
  differingPercentDigits,
  fmtUnitValue,
  releaseLabel,
  shortReleaseId,
} from "./format";

test("percent comparison precision increases until the rendered values differ", () => {
  expect(differingPercentDigits(0.041234, 0.041236)).toBe(3);
  expect(differingPercentDigits(0.04, 0.05)).toBe(1);
});

test("percent comparison precision stops at ten decimal places", () => {
  expect(differingPercentDigits(0.04, 0.04)).toBe(10);
  expect(differingPercentDigits(0.04, 0.04 + 1e-14)).toBe(10);
  expect(differingPercentDigits(null, 0.04)).toBe(1);
});

test("percent-unit values render as percentages from decimal fractions", () => {
  expect(fmtUnitValue(0.134, "percent")).toBe("13.4%");
  expect(fmtUnitValue(0.059, "percent")).toBe("5.9%");
  expect(fmtUnitValue(null, "percent")).toBe("—");
});

test("non-percent units fall back to money formatting", () => {
  expect(fmtUnitValue(79250000000, "currency-USD")).toBe("$79.25B");
  expect(fmtUnitValue(79250000000, null)).toBe("$79.25B");
  expect(fmtUnitValue(79250000000, undefined)).toBe("$79.25B");
  expect(fmtUnitValue(null, null)).toBe("—");
});

test("Belgium Chronicle release labels expose the distinguishing commit", () => {
  expect(
    releaseLabel("microcosm-be-2026-chronicle-3cef97b-20260823T134247Z"),
  ).toBe("2026-08-23 13:42Z · 3cef97b");
});

test("short release ids use six characters from the varying identifier", () => {
  expect(
    shortReleaseId("populace-us-2024-32fcf6b-480cc7c54024-20260702T134754Z"),
  ).toBe("32fcf6");
  expect(shortReleaseId("rel-1")).toBe("rel");
});
