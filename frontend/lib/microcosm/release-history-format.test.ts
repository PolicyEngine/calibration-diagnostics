import { expect, test } from "bun:test";

import {
  commonPrefix,
  currencySymbol,
  dateLong,
  dateShort,
  dateTimeUtc,
  engineLabel,
  formatChange,
  formatPercent,
  formatPoints,
  formatValue,
  periodLabel,
  shortBuildNames,
  shortHash,
  versusOfficial,
} from "./release-history-format";
import { panelPresentation } from "./release-history-summary";
import { readCountryFixture } from "./test-support/release-history-fixture-store";

test("a value is written in its unit", () => {
  expect(currencySymbol("GBP")).toBe("£");
  expect(currencySymbol("USD")).toBe("$");
  expect(currencySymbol(null)).toBe("");
  expect(currencySymbol("not a currency")).toBe("");
  expect(formatValue(25_589_726_500, "currency", "GBP")).toBe("£25.6bn");
  expect(formatValue(-1_234_000_000_000, "currency", "USD")).toBe("−$1.23tn");
  expect(formatValue(4_560_000, "currency", "GBP", 2)).toBe("£4.56m");
  expect(formatValue(28_400_000, "count", null)).toBe("28.40m");
  expect(formatValue(12_345, "count", null)).toBe("12,345");
  expect(formatValue(0.1834, "rate", null)).toBe("18.3%");
  expect(formatValue(-0.4212, "ratio", null)).toBe("−0.42%");
  expect(formatValue(null, "currency", "GBP")).toBe("—");
  expect(formatValue(Number.NaN, "count", null)).toBe("—");
});

test("percentages and points carry their sign, and zero carries none", () => {
  expect(formatPercent(2.345)).toBe("+2.35%");
  expect(formatPercent(-0.5, 1)).toBe("−0.5%");
  expect(formatPercent(0.001)).toBe("0%");
  expect(formatPercent(null)).toBe("—");
  expect(formatPoints(0.125)).toBe("+0.13 pp");
  expect(formatPoints(-1.5)).toBe("−1.50 pp");
  expect(formatPoints(0)).toBe("0 pp");
  expect(versusOfficial(110, 100)).toBeCloseTo(10);
  // A negative official figure (a cost, in the model's sign): above it is still above.
  expect(versusOfficial(-90, -100)).toBeCloseTo(10);
});

test("a step is told in percent for money and counts, in points for rates, and never beside a withheld cell", () => {
  const step = { change: 120_000_000, relativeChange: 0.0045, changePoints: null, changeStatus: "ok" as const };
  expect(formatChange(step, "currency", "GBP")).toBe("+£120.00m (+0.45%)");
  expect(formatChange({ ...step, change: -3_000, relativeChange: -0.01 }, "count", null)).toBe("−3,000 (−1.00%)");
  expect(formatChange({ ...step, relativeChange: null }, "currency", "USD")).toBe("+$120.00m");
  expect(formatChange({ change: 0.002, relativeChange: null, changePoints: 0.2, changeStatus: "ok" }, "rate", null))
    .toBe("+0.20 pp");
  expect(formatChange({ change: null, relativeChange: null, changePoints: null, changeStatus: "withheld" }, "currency", "GBP"))
    .toBe("Withheld");
  expect(formatChange({ change: null, relativeChange: null, changePoints: null, changeStatus: "none" }, "currency", "GBP"))
    .toBe("—");
});

test("a period is named as the producer names it in each country's points", async () => {
  for (const country of ["uk", "us"]) {
    const fixture = await readCountryFixture(country);
    const style = panelPresentation(fixture.panel).periodLabel;
    for (const point of fixture.points) {
      for (const period of point.periods) expect(periodLabel(period.period, style)).toBe(period.label);
    }
  }
  expect(periodLabel(2099, "fiscal_year")).toBe("2099-00");
});

test("publish times are written as UTC dates", () => {
  expect(dateLong("2026-10-19T08:33:00+00:00")).toBe("19 Oct 2026");
  expect(dateShort("2026-11-07T23:30:00-05:00")).toBe("8 Nov");
  expect(dateTimeUtc("2026-10-19T08:33:00+00:00")).toBe("19 Oct 2026, 08:33 UTC");
  expect(dateTimeUtc(null)).toBe("—");
  expect(dateLong("not a date")).toBe("not a date");
});

test("build names drop the prefix they share, cut back to a hyphen", () => {
  const builds = [
    { buildId: "line/attempt-20261019T083300Z-aaaa1111", build: "attempt-20261019T083300Z-aaaa1111" },
    { buildId: "line/attempt-20261107T020434Z-bbbb2222", build: "attempt-20261107T020434Z-bbbb2222" },
  ];
  expect(commonPrefix(builds.map((build) => build.build))).toBe("attempt-");
  expect([...shortBuildNames(builds).values()]).toEqual(["20261019T083300Z-aaaa1111", "20261107T020434Z-bbbb2222"]);
  // One build, or names with nothing in common, keep their whole name.
  expect(shortBuildNames([builds[0]]).get(builds[0].buildId)).toBe(builds[0].build);
  expect(commonPrefix(["alpha", "beta"])).toBe("");
  expect(shortHash("abcdef0123456789")).toBe("abcdef0123");
  expect(shortHash(null)).toBe("—");
  expect(engineLabel("policyengine-uk==1.0.0")).toBe("policyengine-uk 1.0.0");
});
