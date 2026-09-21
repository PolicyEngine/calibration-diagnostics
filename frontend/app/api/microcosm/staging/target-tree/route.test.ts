import { afterEach, expect, test } from "bun:test";

import {
  stagingDiagnosticsFixture,
  stagingTelemetryFetch,
} from "@/lib/microcosm/test-support/staging-run-fixture";

import { GET } from "./route";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("builds the calibration tree from a staging diagnostics artifact", async () => {
  const runId = "uk-fit-map";
  globalThis.fetch = stagingTelemetryFetch(runId, stagingDiagnosticsFixture());

  const response = await GET(
    new Request(`http://example.test/api/microcosm/staging/target-tree?run=${runId}&country=uk`),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    releaseId: `${runId}-candidate`,
    filteredMetrics: { nTargets: 1, within10Pct: 1 },
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("requires a staging run id", async () => {
  const response = await GET(new Request("http://example.test/api/microcosm/staging/target-tree?country=uk"));

  expect(response.status).toBe(400);
});
