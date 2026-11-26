import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createReleaseHistorySummaryHandler } from "../app/api/microcosm/release-history/route";
import { createReleaseHistoryTimelineHandler } from "../app/api/microcosm/release-history/timeline/route";
import { versusOfficial } from "../lib/microcosm/release-history-format";
import { outputEntries } from "../lib/microcosm/release-history-outputs";
import { directoryStore } from "../lib/microcosm/release-history-source";
import type { ReleaseHistoryPanelView, ReleaseHistorySummary } from "../lib/microcosm/release-history-summary";
import { syntheticReleaseHistory } from "../lib/microcosm/test-support/release-history-synthetic-store";
import { writeSyntheticStore } from "./release-history-dev-store";

const API = "https://dashboard.example/calibration/dashboard/api/microcosm/release-history";

test("the synthetic store is the same on every run, and says it is synthetic", async () => {
  const [first, second] = await Promise.all([syntheticReleaseHistory(), syntheticReleaseHistory()]);
  expect([...first.store.objects.keys()].sort()).toEqual([...second.store.objects.keys()].sort());
  for (const [path, object] of first.store.objects) {
    expect(Buffer.from(object.body).equals(Buffer.from(second.store.objects.get(path)!.body))).toBe(true);
  }
  for (const country of Object.values(first.countries)) {
    for (const build of country.series.builds) expect(build.build).toStartWith("synthetic-");
  }
});

test("the routes serve the written folder as they would serve Blob", async () => {
  const out = await mkdtemp(join(tmpdir(), "release-history-dev-store-"));
  const written = await writeSyntheticStore(out);
  expect(written.countries).toEqual(["uk", "us"]);
  expect(written.files).toBeGreaterThan(30);
  const dependencies = { store: () => directoryStore(out) };

  // The UK is mid-way through an engine bump: the page opens the served panel, on the earlier
  // engine, and lists the pinned one, which is still filling.
  const summary = (await (await createReleaseHistorySummaryHandler(dependencies)(
    new Request(`${API}?country=uk`),
  )).json()) as ReleaseHistorySummary;
  expect(summary.available).toBe(true);
  expect(summary.defaultPanelId).toBe(summary.servedPanelId);
  expect(summary.pinnedPanelId).not.toBe(summary.servedPanelId);
  expect(summary.panels.map((panel) => [panel.engine.model, panel.served, panel.pinned, panel.sameDefinitionAsDefault])).toEqual([
    ["policyengine-uk==1.0.0", true, false, true],
    ["policyengine-uk==1.1.0", false, true, true],
  ]);
  expect(summary.panels[0].coverage).toMatchObject({ files: 10, measured: 7, gap: 1, missing: 2 });
  expect(summary.panels[1].coverage).toMatchObject({ files: 10, measured: 7, gap: 1, failed: 1, retrying: 1 });

  const view = (await (await createReleaseHistoryTimelineHandler(dependencies)(
    new Request(`${API}/timeline?country=uk`),
  )).json()) as ReleaseHistoryPanelView;
  expect(view.panelId).toBe(summary.defaultPanelId!);
  expect(view.timeline.builds).toHaveLength(12);
  // Values sit within a few percent of the official figure, where an output has one.
  const entries = outputEntries(view.timeline, view.presentation).filter((entry) => entry.official !== null);
  expect(entries).toHaveLength(13);
  for (const entry of entries) {
    for (const value of entry.values) {
      if (value.value !== null) expect(Math.abs(versusOfficial(value.value, entry.official!))).toBeLessThan(20);
    }
  }

  // The US has a complete panel and a second engine's panel under another definition.
  const us = (await (await createReleaseHistorySummaryHandler(dependencies)(
    new Request(`${API}?country=us`),
  )).json()) as ReleaseHistorySummary;
  expect(us.panels.map((panel) => [panel.engine.model, panel.complete, panel.pinnedAt !== null, panel.sameDefinitionAsDefault])).toEqual([
    ["policyengine-us==1.0.0", true, true, true],
    ["policyengine-us==0.9.0", false, false, false],
  ]);
});
