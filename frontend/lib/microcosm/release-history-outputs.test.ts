import { expect, test } from "bun:test";

import {
  baselineLabel,
  groupedOutputs,
  humanizeId,
  latestValue,
  outputEntries,
  referenceLine,
  timelinePeriods,
} from "./release-history-outputs";
import type { Timeline } from "./release-history-store";
import { panelPresentation } from "./release-history-summary";
import { syntheticPanelView } from "./test-support/release-history-synthetic-view";

test("ids become labels: acronyms in capitals, a person group after a comma, a housing-cost basis in brackets", () => {
  expect(humanizeId("income_tax")).toBe("Income tax");
  expect(humanizeId("vat")).toBe("VAT");
  expect(humanizeId("refundable_ctc")).toBe("Refundable CTC");
  const groups = ["all", "children"];
  expect(baselineLabel("national_insurance", groups)).toBe("National insurance");
  expect(baselineLabel("absolute_poverty_bhc_all", groups)).toBe("Absolute poverty (BHC), everyone");
  expect(baselineLabel("relative_poverty_ahc_children", groups)).toBe("Relative poverty (AHC), children");
  // An id that only happens to end like a group it does not name stays whole.
  expect(baselineLabel("children", groups)).toBe("Children");
  expect(baselineLabel("household_net_income_total", [])).toBe("Household net income total");
});

test("the UK's outputs are grouped by the kind of each baseline item, then by reform, in the spec's order", async () => {
  const { timeline, presentation } = await syntheticPanelView("uk");
  const entries = outputEntries(timeline, presentation);
  expect(entries).toHaveLength(timeline.outputs.length);
  expect(timelinePeriods(entries)).toEqual([2026]);
  const groups = groupedOutputs(entries);
  expect([...groups.keys()]).toEqual([
    "Receipts",
    "Spending",
    "Caseloads",
    "Population",
    "Incomes in the data",
    "Household income",
    "Poverty rates",
    "Household net income mean by income decile",
    "Reform · Basic rate +1p",
    "Reform · Higher rate +1p",
    "Reform · Additional rate +1p",
    "Reform · Personal allowance +£100",
    "Reform · Class 1 employee main NICs rate +1pp",
    "Reform · Child Benefit subsequent child +£1 a week",
    "Reform · VAT standard rate +1pp",
  ]);
  expect(groups.get("Receipts")!.map((entry) => entry.label)).toEqual([
    "Income tax", "National insurance", "VAT", "Council tax", "Capital gains tax",
  ]);
  expect(groups.get("Poverty rates")!.map((entry) => entry.label).slice(0, 2)).toEqual([
    "Absolute poverty (BHC), everyone", "Absolute poverty (AHC), everyone",
  ]);
  expect(groups.get("Household net income mean by income decile")!.map((entry) => entry.label)).toEqual(
    Array.from({ length: 10 }, (_, index) => `Decile ${index + 1}`),
  );
});

test("a reform's outputs run from its target and budgetary impact to its poverty counts, in neutral words", async () => {
  const { timeline, presentation } = await syntheticPanelView("uk");
  const reform = groupedOutputs(outputEntries(timeline, presentation)).get("Reform · Basic rate +1p")!;
  const labels = reform.map((entry) => entry.label);
  expect(labels.slice(0, 4)).toEqual([
    "Change in income tax (target)",
    "Budgetary impact",
    "Change in income tax",
    "Change in national insurance",
  ]);
  expect(labels).toContain("Change in VAT");
  const after = labels.slice(labels.indexOf("Households with higher net income"));
  expect(after.slice(0, 7)).toEqual([
    "Households with higher net income",
    "Households with lower net income",
    "People with higher net income",
    "People with lower net income",
    "Change in net income, all households",
    "Change in net income, decile 1",
    "Change in net income, decile 2",
  ]);
  expect(labels.at(-1)).toBe("Change in people in poverty, relative BHC, children");
  expect(reform[0].fullLabel).toBe("Basic rate +1p · Change in income tax (target)");
  // The page's words for an output never rank a household.
  for (const entry of outputEntries(timeline, presentation)) {
    expect(`${entry.group} ${entry.label}`).not.toMatch(/\b(gaining|losing|winners?|losers?|better|worse)\b/i);
  }
});

test("headline outputs are the baseline totals and each reform's budgetary impact and target", async () => {
  const { timeline, presentation } = await syntheticPanelView("uk");
  const headline = outputEntries(timeline, presentation).filter((entry) => entry.headline);
  // 32 baseline items with a total (the 33rd has decile rows only), and two per reform.
  expect(headline).toHaveLength(32 + 2 * 7);
  expect(headline.every((entry) => !entry.id.includes("decile"))).toBe(true);
});

test("an output's official figure is the reference's value in the model's sign, where it has one", async () => {
  const uk = await syntheticPanelView("uk");
  const entries = outputEntries(uk.timeline, uk.presentation);
  const withOfficial = entries.filter((entry) => entry.official !== null);
  // The references lock resolves 13 UK baseline totals; every reform is a citation with no value.
  expect(withOfficial).toHaveLength(13);
  expect(withOfficial.every((entry) => entry.id.startsWith("baseline/"))).toBe(true);
  const incomeTax = entries.find((entry) => entry.id === "baseline/income_tax")!;
  expect(incomeTax.official).toBe(
    uk.timeline.outputs.find((output) => output.output === "baseline/income_tax")!.reference!.modelSignValue!,
  );
  expect(referenceLine(incomeTax)).toBe("a published figure (forecast), from 1 Chronicle record.");
  const reform = entries.find((entry) => entry.id === "reform/basic_rate_plus_1p/budgetary_impact")!;
  expect(reform.official).toBeNull();
  expect(referenceLine(reform)).toStartWith(
    "cited, with no value yet: HM Revenue & Customs, Direct effects of illustrative tax changes (tax ready reckoner), June 2025,",
  );
  const poverty = entries.find((entry) => entry.id === "baseline/absolute_poverty_bhc_all")!;
  expect(referenceLine(poverty)).toBe("HBAI has no 2026-27 figure yet.");
  const decile = entries.find((entry) => entry.id === "baseline/household_net_income_mean/decile_3")!;
  expect(referenceLine(decile)).toBe("none listed for this output.");

  const us = await syntheticPanelView("us");
  const usEntries = outputEntries(us.timeline, us.presentation);
  expect(usEntries.some((entry) => entry.official !== null)).toBe(false);
  expect([...groupedOutputs(usEntries).keys()]).toEqual([
    "Receipts",
    "Other programmes",
    "Spending",
    "Population",
    "Reform · All individual income tax rates +1pt",
    "Reform · ARPA 2021 Child Tax Credit expansion",
  ]);
});

test("an entry holds no number for a cell that is not ok, whatever the document carries", async () => {
  const { timeline, presentation } = await syntheticPanelView("uk");
  const entries = outputEntries(timeline, presentation);
  const withheld = entries.flatMap((entry) => entry.values).filter((value) => value.status === "withheld");
  expect(withheld.length).toBeGreaterThan(0);
  for (const value of entries.flatMap((entry) => entry.values)) {
    if (value.status !== "ok") expect(value.value).toBeNull();
    if (value.changeStatus !== "ok" || value.status !== "ok") {
      expect([value.change, value.relativeChange, value.changePoints]).toEqual([null, null, null]);
    }
  }

  // A timeline that wrongly carried numbers beside a withheld status gives the page none.
  const leaking: Timeline = structuredClone(timeline);
  const output = leaking.outputs.find((candidate) => candidate.values.some((value) => value.status === "withheld"))!;
  const index = output.values.findIndex((value) => value.status === "withheld");
  Object.assign(output.values[index], { value: 4321.5, change: 12, relativeChange: 0.5, changePoints: 3, changeStatus: "ok" });
  const entry = outputEntries(leaking, presentation).find((candidate) => candidate.id === output.output)!;
  expect(entry.values[index]).toMatchObject({ status: "withheld", value: null, change: null, relativeChange: null, changePoints: null });
  expect(JSON.stringify(entry.values)).not.toContain("4321.5");
});

test("the latest value is the newest one on the axis, never a withdrawn build's", async () => {
  const { timeline, presentation } = await syntheticPanelView("uk");
  const entry = outputEntries(timeline, presentation).find((candidate) => candidate.id === "baseline/income_tax")!;
  const latest = latestValue(entry, timeline.builds)!;
  // The served panel never ran the two newest builds: its latest value is the 10 November build's.
  expect(timeline.builds[latest.index].publishedAt).toBe("2026-11-10T09:31:00+00:00");
  const withdrawnOnly = {
    ...entry,
    values: entry.values.map((value, index) => (timeline.builds[index].withdrawn ? value : { ...value, value: null })),
  };
  expect(withdrawnOnly.values.some((value) => value.value !== null)).toBe(true);
  expect(latestValue(withdrawnOnly, timeline.builds)).toBeNull();
});

test("an output the spec does not name still gets a label, after the ones it does", async () => {
  const { timeline } = await syntheticPanelView("us");
  const entries = outputEntries(
    { ...timeline, outputs: [...timeline.outputs, { ...timeline.outputs[0], output: "something/new_kind" }] },
    panelPresentation(null),
  );
  expect(entries.at(-1)).toMatchObject({ group: "Other outputs", label: "Something new kind", headline: false });
  // With no panel.json every baseline item is still listed, in one group.
  expect(entries[0].group).toBe("Other baseline items");
});
