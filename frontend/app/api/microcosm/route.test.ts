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

test("reviews a staging candidate with the release summary", async () => {
  const runId = "uk-candidate-summary";
  globalThis.fetch = stagingTelemetryFetch(runId, stagingDiagnosticsFixture());

  const response = await GET(
    new Request(`http://example.test/api/microcosm?release=staging:${runId}&country=uk`),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({
    selection_mode: "staging_candidate",
    staging_run_id: runId,
    source: "huggingface_live",
    source_repo: "policyengine/populace-uk-staging",
    release_id: `${runId}-candidate`,
    calibration: { available: true, total_targets: 1, within_tolerance_count: 1 },
  });
  expect(body.source_artifacts.map((artifact: { path: string }) => artifact.path)).toEqual([
    `runs/${runId}/run_manifest.json`,
    `runs/${runId}/progress.json`,
  ]);
  expect(body.limitations[0]).toContain("unreleased staging candidate");
  // Never the release listing's shape: no latest pointer, nothing under releases/.
  expect(JSON.stringify(body)).not.toContain("releases/");
});

test("a candidate without calibration diagnostics is absent, not an upstream failure", async () => {
  const runId = "uk-candidate-no-diagnostics";
  globalThis.fetch = stagingTelemetryFetch(runId, null);

  const response = await GET(
    new Request(`http://example.test/api/microcosm?release=staging:${runId}&country=uk`),
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    detail: "This staging run has not uploaded calibration diagnostics yet.",
  });
});

test("a bare staging prefix is an invalid release id", async () => {
  globalThis.fetch = stagingTelemetryFetch("unused", null);

  const response = await GET(
    new Request("http://example.test/api/microcosm?release=staging:&country=uk"),
  );

  expect(response.status).toBe(400);
});
