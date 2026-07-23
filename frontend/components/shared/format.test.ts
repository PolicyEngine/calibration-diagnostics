import { expect, test } from "bun:test";

import { fmtUnitValue } from "./format";

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
