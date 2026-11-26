import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { dateShort } from "@/lib/microcosm/release-history-format";
import { readReleaseHistoryManifest } from "@/lib/microcosm/release-history-read";
import {
  releaseHistorySummary,
  type ReleaseHistoryPanelView,
  type ReleaseHistorySummary,
} from "@/lib/microcosm/release-history-summary";
import { releaseHistoryUrlState, type ReleaseHistoryUrlState } from "@/lib/microcosm/release-history-url";
import { sharedSyntheticReleaseHistory } from "@/lib/microcosm/test-support/release-history-synthetic-store";
import { syntheticPanelView } from "@/lib/microcosm/test-support/release-history-synthetic-view";
import { ReleaseHistoryActions, ReleaseHistoryPanel } from "./release-history-view";

// The page on the synthetic store, rendered to static markup: what a reader is told, in words.

async function summaryOf(country: "uk" | "us"): Promise<ReleaseHistorySummary> {
  const { store } = await sharedSyntheticReleaseHistory();
  return releaseHistorySummary(country, await readReleaseHistoryManifest(store));
}

function state(patch: Partial<ReleaseHistoryUrlState> = {}): ReleaseHistoryUrlState {
  return { ...releaseHistoryUrlState(new URLSearchParams()), ...patch };
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

async function page(
  country: "uk" | "us",
  engine: "earlier" | "newer" | "other",
  patch: Partial<ReleaseHistoryUrlState> = {},
  change: (view: ReleaseHistoryPanelView) => ReleaseHistoryPanelView = (view) => view,
) {
  const view = change(await syntheticPanelView(country, engine));
  const markup = renderToStaticMarkup(
    createElement(ReleaseHistoryPanel, { summary: await summaryOf(country), view, state: state(patch), onState: () => {} }),
  );
  return { view, markup, said: text(markup) };
}

const buildOn = (view: ReleaseHistoryPanelView, date: string) =>
  view.timeline.builds.find((build) => dateShort(build.publishedAt) === date)!;

test("the default view names the engine, what it lacks, what moved, the builds and the first output", async () => {
  const { said, markup } = await page("uk", "earlier");
  // After an engine bump the page shows the served panel and says a newer engine is filling.
  expect(said).toContain("A newer engine is being measured. policyengine-uk 1.1.0 was pinned on 25 Nov 2026 and holds 7 of 10 files so far.");
  expect(said).toContain("View policyengine-uk 1.1.0");
  // The builds this engine has no value for are named, by why.
  expect(said).toContain("3 of 11 builds have no value on this engine.");
  expect(said).toMatch(/Never run on this engine: 17 Nov \(20261117T020400Z-[0-9a-f]{8}\), 24 Nov \(20261124T020400Z-[0-9a-f]{8}\)/);
  expect(said).toMatch(/The file was refused: 24 Oct \(/);
  expect(said).toContain("New builds are measured automatically on the pinned engine only.");
  // The series facts.
  expect(said).toContain("policyengine-uk 1.0.0 · policyengine 6.16.1 · policyengine-core 3.33.3");
  expect(said).toContain("microcosm-uk-2024-25-national · published from 19 Oct 2026");
  expect(said).toContain("12 builds listed · 7 of 10 files measured · 2026-27");
  expect(said).toContain("A value that rests on fewer than 3 survey households is withheld, with any partner cell that would give it back.");
  // What moved, the builds, and the first output of the spec.
  expect(said).toContain("What moved at the latest build");
  expect(said).toMatch(/From 7 Nov \([^)]+\) to 10 Nov \([^)]+\), on this engine\./);
  expect(said).toContain("Ranked by each output's step beside its own typical step");
  expect(said).toContain("Builds in the series");
  for (const chip of ["Measured", "File refused", "Not measured", "Withdrawn", "Same file as 21 Oct", "Current", "New build engine"]) {
    expect(said).toContain(chip);
  }
  expect(said).toContain("Receipts Income tax 2026-27 · in GBP");
  expect(said).toContain("Each release as a % above or below the official figure, £");
  expect(said).toContain("0% = official £");
  expect(said).toContain("Official reference: £");
  // The table is there for every reader, closed until asked for.
  expect(markup).toContain("<details");
  expect(markup).not.toContain("<details open");
  expect(said).toContain("Show the table of builds");
  // The chart says what it shows, and every column can be reached by keyboard.
  expect(markup).toContain('role="img"');
  expect(markup).toMatch(/aria-label="Income tax, as a % above or below its official figure, across 12 builds\./);
  expect(markup.match(/aria-pressed="false"/g)!.length).toBeGreaterThanOrEqual(24);
  // Neutral words only.
  expect(said).not.toMatch(/\b(better|worse|improved|regressed|gaining|losing|winners?|losers?)\b/i);
});

test("an output with no official figure shows values and says why", async () => {
  const { said } = await page("uk", "earlier", { output: "reform/basic_rate_plus_1p/budgetary_impact" });
  expect(said).toContain("Reform · Basic rate +1p Budgetary impact");
  expect(said).toContain("No official figure for this output, so it shows values.");
  expect(said).toContain("Official reference: cited, with no value yet: HM Revenue & Customs");
  expect(said).not.toContain("0% = official");
  const absolute = await page("uk", "earlier", { scale: "absolute" });
  expect(absolute.said).toContain("Values, in GBP.");
  expect(absolute.said).toContain("Official £");
});

test("an output whose id spells gaining or losing is shown in neutral words only", async () => {
  // The producer's ids for these four outputs are `households_gaining` and the like. The page
  // labels them, and never prints the id.
  for (const kind of ["households_gaining", "households_losing", "people_gaining", "people_losing"]) {
    const { said } = await page("uk", "earlier", { output: `reform/basic_rate_plus_1p/${kind}`, moved: "all" });
    expect(said).toMatch(/(Households|People) with (higher|lower) net income \d{4}-\d{2} · a count/);
    expect(said).not.toMatch(/gaining|losing|winner|loser/i);
  }
});

test("a withheld cell is shown as withheld and no number of it reaches the page", async () => {
  const output = "baseline/household_net_income_mean/decile_1";
  const { said, view } = await page("uk", "earlier", { output, scale: "absolute" });
  expect(said).toContain("withheld");
  expect(said).toContain("4 withheld");
  expect(said).toMatch(/Step from the build before\s+Withheld/);

  // A timeline that wrongly carried numbers beside a withheld status: none is rendered anywhere.
  const leaked = await page("uk", "earlier", { output, scale: "absolute", step: buildOn(view, "2 Nov").buildId }, (clean) => {
    const copy = structuredClone(clean);
    const raw = copy.timeline.outputs.find((candidate) => candidate.output === output)!;
    for (const value of raw.values) {
      if (value.status !== "withheld") continue;
      Object.assign(value, { value: 987654.321, change: 123456.789, relativeChange: 0.4242, changePoints: 42.42 });
    }
    return copy;
  });
  // However the page would write them: in full, grouped, compact, or as a percentage.
  for (const number of ["987654", "987,654", "987.65", "123456", "123,457", "123.46", "42.42"]) {
    expect(leaked.markup).not.toContain(number);
  }
  expect(leaked.said).toMatch(/Household net income mean, decile 1\s+Withheld/);
});

test("a step's card sets the two builds side by side, from the build before the withdrawn one", async () => {
  const served = await syntheticPanelView("uk");
  const { said, markup } = await page("uk", "earlier", { step: buildOn(served, "2 Nov").buildId });
  expect(said).toContain("Step from 27 Oct 2026 to 2 Nov 2026");
  expect(said).toContain("Built with model Changed policyengine-uk 0.9.0 policyengine-uk 0.10.0");
  expect(said).toContain("Targets Changed 1,200 1,214");
  expect(said).toContain("Target registry Unchanged 2026.10 2026.10");
  expect(said).toContain("Outside the range it declares (policyengine-uk ==0.10.0)");
  expect(said).toContain("Columns the reference model does not define: added synthetic_new_column.");
  expect(said).toMatch(/Every output at this step \d+ moved, \d+ did not move, \d+ withheld/);
  expect(markup).toMatch(/href="https:\/\/github\.com\/PolicyEngine\/microcosm\/compare\/[0-9a-f]{40}\.\.\.[0-9a-f]{40}"/);
  expect(said).toContain("Compare the two Microcosm commits on GitHub");
  expect(markup).toMatch(/href="\/microcosm\?country=uk&amp;release=microcosm-uk-2024-25-national%2Fsynthetic-/);
  // The selected column and card are marked for assistive technology.
  expect(markup).toContain('aria-pressed="true"');

  const withdrawn = await page("uk", "earlier", { step: buildOn(served, "29 Oct").buildId });
  expect(withdrawn.said).toContain("Build of 29 Oct 2026");
  expect(withdrawn.said).toContain("This build was withdrawn, so no step starts or ends at it.");
  const afterGap = await page("uk", "earlier", { step: buildOn(served, "27 Oct").buildId });
  expect(afterGap.said).toContain("This engine holds no value for the build before it.");
});

test("on the pinned engine that is still filling, the page says so and names its failed and retrying builds", async () => {
  const { said } = await page("uk", "newer");
  expect(said).toContain("This engine's panel is filling. policyengine-uk 1.1.0 holds 7 of 10 files. Until it is complete this page opens policyengine-uk 1.0.0.");
  expect(said).toMatch(/A run failed and will be tried again: 24 Nov \(/);
  expect(said).toMatch(/Out of attempts: 5 Nov \(/);
  // The states are named for what happened to the run, on the chips and on the chart alike.
  expect(said).toContain("Retrying");
  expect(said).not.toMatch(/\bFailed\b|\bGap\b/);
  expect(said).not.toContain("Never run on this engine");
});

test("an engine measured on request under another definition says both, and a complete panel says neither", async () => {
  const other = await page("us", "other");
  expect(other.said).toContain("policyengine-us 0.9.0 was measured on request.");
  expect(other.said).toContain("Another definition.");
  expect(other.said).toContain("never pinned: measured on request");
  expect(other.said).toContain("4 of 6 builds have no value on this engine.");
  const complete = await page("us", "earlier");
  expect(complete.said).not.toContain("measured on request");
  expect(complete.said).not.toContain("have no value on this engine");
  expect(complete.said).toContain("No value is withheld: this country's policy checks none.");
  // No US output has an official figure in the references, so every chart shows values.
  expect(complete.said).toContain("No official figure for this output, so it shows values.");
});

test("a URL that names an output or a step this panel does not hold opens the defaults", async () => {
  const { said } = await page("us", "earlier", { output: "baseline/not_an_output", step: "line/not-a-build", period: 1999 });
  expect(said).toContain("Receipts Income tax 2026 · in USD");
  // No step card: neither a step's nor a single build's.
  expect(said).not.toContain("The two builds");
  expect(said).not.toContain("Build of ");
});

test("the header offers each engine's panel and the table as a CSV", async () => {
  const summary = await summaryOf("uk");
  const markup = renderToStaticMarkup(
    createElement(ReleaseHistoryActions, { summary, panelId: summary.defaultPanelId!, onSelectPanel: () => {} }),
  );
  expect(text(markup)).toContain("policyengine-uk 1.0.0 · 7 of 10 files");
  expect(text(markup)).toContain("policyengine-uk 1.1.0 · 7 of 10 files");
  expect(markup).toContain(
    `href="/calibration/dashboard/api/microcosm/release-history/export?country=uk&amp;panel=${summary.defaultPanelId}"`,
  );
  expect(text(markup)).toContain("Download CSV");
});
