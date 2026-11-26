import { expect, test } from "bun:test";

import {
  encodeDocument,
  memoryStore,
  RELEASE_HISTORY_MANIFEST_PATH,
  type ReleaseHistoryStore,
} from "@/lib/microcosm/release-history-store";
import type { ReleaseHistorySummary } from "@/lib/microcosm/release-history-summary";
import { fixtureStore } from "@/lib/microcosm/test-support/release-history-fixture-store";
import { createReleaseHistorySummaryHandler } from "./route";

const URL_BASE = "https://dashboard.example/calibration/dashboard/api/microcosm/release-history";

function handler(store: ReleaseHistoryStore) {
  return createReleaseHistorySummaryHandler({ store: () => store });
}

test("the summary names a country's panels, their engines, and the panel the page opens", async () => {
  const { store, fixtures } = await fixtureStore();
  const response = await handler(store)(new Request(`${URL_BASE}?country=uk`));
  expect(response.status).toBe(200);
  const body = (await response.json()) as ReleaseHistorySummary;
  const panelId = fixtures.uk.panel.panel_id;
  expect(body).toMatchObject({
    country: "uk",
    available: true,
    defaultPanelId: panelId,
    pinnedPanelId: panelId,
    servedPanelId: panelId,
  });
  expect(body.panels).toHaveLength(1);
  expect(body.panels[0]).toMatchObject({
    panelId,
    engine: { policyengine: "6.16.1", model: "policyengine-uk==1.0.0", core: "policyengine-core==3.33.3" },
    pinned: true,
    served: true,
    complete: true,
    // Five listed builds; the withdrawn one is off the axis, and two builds share a file.
    coverage: { builds: 4, files: 3, measured: 2, gap: 1, retrying: 0, failed: 0, missing: 0 },
  });
  expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  expect(response.headers.get("vercel-cdn-cache-control")).toContain("max-age=60");
  // The other country's panels are its own.
  const us = (await (await handler(store)(new Request(`${URL_BASE}?country=us`))).json()) as ReleaseHistorySummary;
  expect(us.defaultPanelId).toBe(fixtures.us.panel.panel_id);
  expect(us.panels.map((panel) => panel.panelId)).toEqual([fixtures.us.panel.panel_id]);
});

test("a configured country with no stored history answers available: false", async () => {
  const { store } = await fixtureStore(["uk"]);
  for (const target of [store, memoryStore()]) {
    const response = await handler(target)(new Request(`${URL_BASE}?country=us`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ country: "us", available: false, defaultPanelId: null, panels: [] });
  }
});

test("the summary needs a country, and refuses one the dashboard does not serve before reading", async () => {
  let reads = 0;
  const counting: ReleaseHistoryStore = {
    ...memoryStore(),
    read: async () => {
      reads += 1;
      return null;
    },
  };
  expect((await handler(counting)(new Request(URL_BASE))).status).toBe(400);
  const response = await handler(counting)(new Request(`${URL_BASE}?country=zz`));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: "country_not_configured", requested_country: "zz" });
  expect(reads).toBe(0);
});

test("a store that cannot be read, or a manifest this code does not read, is a 503 that says no more", async () => {
  const failing: ReleaseHistoryStore = {
    ...memoryStore(),
    read: async () => {
      throw new Error("token vercel_blob_rw_secret refused");
    },
  };
  const unreadable = memoryStore();
  await unreadable.write(RELEASE_HISTORY_MANIFEST_PATH, encodeDocument({ formatVersion: 2, countries: {} }), "create", false);
  const logged = console.error;
  console.error = () => {};
  try {
    for (const store of [failing, unreadable]) {
      const response = await handler(store)(new Request(`${URL_BASE}?country=uk`));
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ detail: "The release history could not be read." });
    }
  } finally {
    console.error = logged;
  }
});
