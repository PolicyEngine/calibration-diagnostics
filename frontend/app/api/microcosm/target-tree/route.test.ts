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

test("builds the calibration tree for a staging candidate selected as a release", async () => {
  const runId = "uk-candidate-tree";
  globalThis.fetch = stagingTelemetryFetch(runId, stagingDiagnosticsFixture());

  const response = await GET(
    new Request(`http://example.test/api/microcosm/target-tree?release=staging:${runId}&country=uk`),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    releaseId: `${runId}-candidate`,
    filteredMetrics: { nTargets: 1, within10Pct: 1 },
  });
});

test("a staging candidate without diagnostics is absent", async () => {
  const runId = "uk-candidate-tree-empty";
  globalThis.fetch = stagingTelemetryFetch(runId, null);

  const response = await GET(
    new Request(`http://example.test/api/microcosm/target-tree?release=staging:${runId}&country=uk`),
  );

  expect(response.status).toBe(404);
});
