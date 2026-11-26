import { expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";

import { timelineCsv } from "@/lib/microcosm/release-history-export";
import type { ReleaseHistoryStore } from "@/lib/microcosm/release-history-store";
import { fixtureStore } from "@/lib/microcosm/test-support/release-history-fixture-store";
import { createReleaseHistoryExportHandler } from "./route";

const URL_BASE = "https://dashboard.example/calibration/dashboard/api/microcosm/release-history/export";

function handler(store: ReleaseHistoryStore) {
  return createReleaseHistoryExportHandler({ store: () => store });
}

test("the export is the panel's table as a CSV download named by country and panel", async () => {
  const { store, fixtures } = await fixtureStore();
  const response = await handler(store)(new Request(`${URL_BASE}?country=uk`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="release-history-uk-${fixtures.uk.panel.panel_id.slice(0, 12)}.csv"`,
  );
  const text = await response.text();
  expect(text).toBe(timelineCsv(fixtures.uk.timeline));
  expect(text.startsWith("build_id,published_at,current,withdrawn,")).toBe(true);

  const compressed = await handler(store)(
    new Request(`${URL_BASE}?country=us&panel=${fixtures.us.panel.panel_id}`, { headers: { "accept-encoding": "gzip" } }),
  );
  expect(compressed.headers.get("content-encoding")).toBe("gzip");
  expect(gunzipSync(new Uint8Array(await compressed.arrayBuffer())).toString("utf8"))
    .toBe(timelineCsv(fixtures.us.timeline));
});

test("the export refuses what the timeline route refuses", async () => {
  const { store } = await fixtureStore(["uk"]);
  expect((await handler(store)(new Request(URL_BASE))).status).toBe(400);
  expect((await handler(store)(new Request(`${URL_BASE}?country=zz`))).status).toBe(404);
  expect((await handler(store)(new Request(`${URL_BASE}?country=uk&panel=nope`))).status).toBe(400);
  expect((await handler(store)(new Request(`${URL_BASE}?country=uk&panel=${"0".repeat(64)}`))).status).toBe(404);
  expect((await handler(store)(new Request(`${URL_BASE}?country=us`))).status).toBe(404);
});
