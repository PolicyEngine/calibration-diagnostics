import { expect, test } from "bun:test";

import {
  disclosureLine,
  engineNotices,
  engineOptions,
  namedBuilds,
  pageSelection,
  selectedPanelId,
  staleState,
} from "./release-history-page";
import { readReleaseHistoryManifest } from "./release-history-read";
import { releaseHistorySummary, type ReleaseHistorySummary } from "./release-history-summary";
import { sharedSyntheticReleaseHistory } from "./test-support/release-history-synthetic-store";
import { syntheticPanelView } from "./test-support/release-history-synthetic-view";

async function summaryOf(country: "uk" | "us") {
  const { store, countries } = await sharedSyntheticReleaseHistory();
  return {
    summary: releaseHistorySummary(country, await readReleaseHistoryManifest(store)),
    panels: countries[country].panels,
  };
}

test("the URL's panel is used when the country has it, and the default one otherwise", async () => {
  const { summary, panels } = await summaryOf("uk");
  expect(selectedPanelId(summary, null)).toBe(panels.earlier);
  expect(selectedPanelId(summary, panels.newer)).toBe(panels.newer);
  // A panel of another country, as a link kept across a change of country would name.
  expect(selectedPanelId(summary, (await summaryOf("us")).panels.earlier)).toBe(panels.earlier);
  expect(selectedPanelId(summary, "not a panel")).toBe(panels.earlier);
});

test("the engine toggle lists each panel by its model and what it holds", async () => {
  const uk = await summaryOf("uk");
  expect(engineOptions(uk.summary)).toEqual([
    { value: uk.panels.earlier, label: "policyengine-uk 1.0.0 · 7 of 10 files" },
    { value: uk.panels.newer, label: "policyengine-uk 1.1.0 · 7 of 10 files" },
  ]);
  const us = await summaryOf("us");
  expect(engineOptions(us.summary).map((option) => option.label)).toEqual([
    "policyengine-us 1.0.0 · 5 of 5 files",
    "policyengine-us 0.9.0 · 2 of 5 files · other definition",
  ]);
  // Two panels on one engine are told apart by their definition.
  const twice: ReleaseHistorySummary = {
    ...us.summary,
    panels: us.summary.panels.map((panel) => ({ ...panel, engine: us.summary.panels[0].engine })),
  };
  const labels = engineOptions(twice).map((option) => option.label);
  expect(labels[0]).toMatch(/^policyengine-us 1\.0\.0 · 5 of 5 files · definition [0-9a-f]{7}$/);
  expect(labels[1]).toMatch(/^policyengine-us 1\.0\.0 · 2 of 5 files · definition [0-9a-f]{7}$/);
  expect(labels[0].slice(-7)).not.toBe(labels[1].slice(-7));
});

test("the notices say which engine is on screen and where the other one is", async () => {
  const uk = await summaryOf("uk");
  // The default view during an engine bump: the newer engine is filling.
  expect(engineNotices(uk.summary, uk.panels.earlier)).toEqual([
    {
      kind: "newer_engine_filling",
      engine: "policyengine-uk 1.1.0",
      pinnedAt: "2026-11-25T05:00:00Z",
      coverage: "7 of 10 files",
      panelId: uk.panels.newer,
    },
  ]);
  // The newer engine itself: still filling, with the way back.
  expect(engineNotices(uk.summary, uk.panels.newer)).toEqual([
    {
      kind: "viewing_filling_engine",
      engine: "policyengine-uk 1.1.0",
      coverage: "7 of 10 files",
      defaultEngine: "policyengine-uk 1.0.0",
      defaultPanelId: uk.panels.earlier,
    },
  ]);
  const us = await summaryOf("us");
  // A complete, pinned panel needs no notice.
  expect(engineNotices(us.summary, us.panels.earlier)).toEqual([]);
  expect(engineNotices(us.summary, us.panels.other).map((notice) => notice.kind)).toEqual([
    "viewing_other_engine",
    "other_definition",
  ]);
  expect(engineNotices(us.summary, "not a panel")).toEqual([]);
});

test("the URL selects an output, a period and a step, and anything it cannot use is the default", async () => {
  const view = await syntheticPanelView("uk");
  const first = pageSelection(view, { output: null, period: null, step: null });
  expect(first.period).toBe(2026);
  expect(first.periods).toEqual([2026]);
  expect(first.entry!.id).toBe("baseline/income_tax");
  expect(first.stepIndex).toBeNull();
  expect(first.periodEntries).toHaveLength(view.timeline.outputs.length);

  const chosen = pageSelection(view, {
    output: "reform/vat_standard_rate_plus_1pp/budgetary_impact",
    period: 2026,
    step: view.timeline.builds[6].buildId,
  });
  expect(chosen.entry!.fullLabel).toBe("VAT standard rate +1pp · Budgetary impact");
  expect(chosen.stepIndex).toBe(6);

  const stale = pageSelection(view, { output: "baseline/eitc", period: 1999, step: "another/build" });
  expect(stale).toMatchObject({ period: 2026, stepIndex: null });
  expect(stale.entry!.id).toBe("baseline/income_tax");

  // What the panel cannot use leaves the URL; what it shows stays.
  expect(staleState(stale, { output: "baseline/eitc", period: 1999, step: "another/build" })).toEqual({
    output: null,
    period: null,
    step: null,
  });
  expect(staleState(chosen, {
    output: "reform/vat_standard_rate_plus_1pp/budgetary_impact",
    period: 2026,
    step: view.timeline.builds[6].buildId,
  })).toEqual({});
  expect(staleState(first, { output: null, period: null, step: null })).toEqual({});

  // A timeline with no output selects nothing, and does not throw.
  const empty = pageSelection({ ...view, timeline: { ...view.timeline, outputs: [] } }, { output: null, period: null, step: null });
  expect(empty).toMatchObject({ entry: null, periods: [], periodEntries: [] });
});

test("the disclosure line states the country's policy, from its spec", () => {
  expect(disclosureLine({ policy: "source_household_small_cells", minSourceHouseholds: 3 })).toBe(
    "A value that rests on fewer than 3 survey households is withheld, with any partner cell that would give it back.",
  );
  expect(disclosureLine({ policy: "source_household_small_cells", minSourceHouseholds: 10 })).toContain("fewer than 10 survey households");
  expect(disclosureLine({ policy: "none", minSourceHouseholds: 3 })).toBe("No value is withheld: this country's policy checks none.");
  expect(disclosureLine({ policy: "keyed_noise", minSourceHouseholds: null })).toBe("Disclosure policy: keyed noise.");
  expect(disclosureLine({ policy: null, minSourceHouseholds: null })).toBe("Disclosure policy not recorded.");
});

test("builds are named by date and short name", () => {
  const builds = [
    { buildId: "line/a", publishedAt: "2026-11-17T02:04:00+00:00" },
    { buildId: "line/b", publishedAt: "2026-11-24T02:04:00+00:00" },
  ];
  expect(namedBuilds(builds, new Map([["line/a", "a"]]))).toBe("17 Nov (a), 24 Nov (line/b)");
});
