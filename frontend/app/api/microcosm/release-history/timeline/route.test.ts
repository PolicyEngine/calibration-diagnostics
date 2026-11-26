import { expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";

import {
  encodeDocument,
  panelPrefix,
  type ReleaseHistoryStore,
} from "@/lib/microcosm/release-history-store";
import type { ReleaseHistoryPanelView } from "@/lib/microcosm/release-history-summary";
import { fixtureStore } from "@/lib/microcosm/test-support/release-history-fixture-store";
import { createReleaseHistoryTimelineHandler } from "./route";

const URL_BASE = "https://dashboard.example/calibration/dashboard/api/microcosm/release-history/timeline";

function handler(store: ReleaseHistoryStore) {
  return createReleaseHistoryTimelineHandler({ store: () => store });
}

async function silenced<T>(run: () => Promise<T>): Promise<T> {
  const logged = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = logged;
  }
}

test("without a panel the route serves the panel the page opens: its summary, presentation and whole timeline", async () => {
  const { store, fixtures } = await fixtureStore();
  const response = await handler(store)(new Request(`${URL_BASE}?country=uk`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("content-encoding")).toBeNull();
  expect(response.headers.get("vary")).toBe("Accept-Encoding");
  expect(response.headers.get("vercel-cdn-cache-control")).toContain("max-age=60");
  const view = (await response.json()) as ReleaseHistoryPanelView;
  expect(view.country).toBe("uk");
  expect(view.panelId).toBe(fixtures.uk.panel.panel_id);
  expect(view.panel).toMatchObject({ panelId: fixtures.uk.panel.panel_id, served: true, complete: true });
  expect(view.presentation).toMatchObject({ currency: "GBP", periodLabel: "fiscal_year", periods: [2026] });
  expect(view.timeline).toEqual(fixtures.uk.timeline);
  // Naming that panel gives the same document.
  const named = await handler(store)(new Request(`${URL_BASE}?country=uk&panel=${fixtures.uk.panel.panel_id}`));
  expect(await named.json()).toEqual(view);
});

test("a client that accepts gzip gets the same document compressed", async () => {
  const { store } = await fixtureStore(["uk"]);
  const plain = await (await handler(store)(new Request(`${URL_BASE}?country=uk`))).text();
  const response = await handler(store)(
    new Request(`${URL_BASE}?country=uk`, { headers: { "accept-encoding": "gzip, br" } }),
  );
  expect(response.headers.get("content-encoding")).toBe("gzip");
  const compressed = new Uint8Array(await response.arrayBuffer());
  expect(gunzipSync(compressed).toString("utf8")).toBe(plain);
  expect(compressed.length).toBeLessThan(plain.length / 4);
});

test("a panel id must be well formed, and only a panel the country's manifest lists is read", async () => {
  const { store, fixtures } = await fixtureStore();
  const malformed = await handler(store)(new Request(`${URL_BASE}?country=uk&panel=../us`));
  expect(malformed.status).toBe(400);

  const unknown = await handler(store)(new Request(`${URL_BASE}?country=uk&panel=${"0".repeat(64)}`));
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ detail: "No such release history panel for uk." });

  // Another country's panel is not this country's.
  const foreign = await handler(store)(new Request(`${URL_BASE}?country=uk&panel=${fixtures.us.panel.panel_id}`));
  expect(foreign.status).toBe(404);

  // A timeline that sits in the store under a panel the manifest does not list is never served.
  const stray = "d".repeat(64);
  await store.write(
    `${panelPrefix("uk", stray)}timeline.json`,
    encodeDocument({ ...fixtures.uk.timeline, panelId: stray }),
    "replace",
    false,
  );
  expect((await handler(store)(new Request(`${URL_BASE}?country=uk&panel=${stray}`))).status).toBe(404);
});

test("a country with no history, and a panel with no timeline, are 404s with no cache", async () => {
  const { store, fixtures } = await fixtureStore(["uk"]);
  const none = await handler(store)(new Request(`${URL_BASE}?country=us`));
  expect(none.status).toBe(404);
  expect(none.headers.get("cache-control")).toBe("no-store");
  expect(await none.json()).toEqual({ detail: "No release history is stored for us yet." });

  store.objects.delete(`${panelPrefix("uk", fixtures.uk.panel.panel_id)}timeline.json`);
  const missing = await handler(store)(new Request(`${URL_BASE}?country=uk`));
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ detail: "This panel has no timeline yet." });
});

test("a stored timeline that is not this panel's, or not a timeline, is a 502", async () => {
  const { store, fixtures } = await fixtureStore();
  const path = `${panelPrefix("uk", fixtures.uk.panel.panel_id)}timeline.json`;
  const wrong = [
    fixtures.us.timeline,
    { ...fixtures.uk.timeline, formatVersion: 2 },
    { ...fixtures.uk.timeline, kind: "release_history.series" },
    { ...fixtures.uk.timeline, outputs: null },
  ];
  await silenced(async () => {
    for (const document of wrong) {
      await store.write(path, encodeDocument(document), "replace", false);
      const response = await handler(store)(new Request(`${URL_BASE}?country=uk`));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ detail: "The stored timeline could not be read." });
    }
  });
});

test("the route needs a country and refuses one the dashboard does not serve", async () => {
  const { store } = await fixtureStore(["uk"]);
  expect((await handler(store)(new Request(URL_BASE))).status).toBe(400);
  const response = await handler(store)(new Request(`${URL_BASE}?country=nz`));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: "country_not_configured" });
});
