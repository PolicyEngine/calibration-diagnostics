import { afterEach, expect, test } from "bun:test";

import { GET } from "./route";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function runManifest(runId: string) {
  return {
    schema_name: "microcosm.staging.run-manifest",
    schema_version: 2,
    run_id: runId,
    country_code: "GB",
    operation_id: "uk_national_calibration",
    pipeline: { id: "uk_national_calibration", version: "2026.09" },
    candidate_id: `${runId}-candidate`,
    release_id: null,
    run_kind: "calibration",
    non_release: true,
    started_at: "2026-01-03T00:00:00+00:00",
    updated_at: "2026-01-03T00:00:03+00:00",
    status: "completed",
    current_stage: "complete",
    sample: { mode: "full" },
    delivery: {
      contract_version: 2,
      enabled: true,
      mode: "local_only",
      run_id: runId,
      configured_repository: null,
      upload_attempts: 0,
      upload_successes: 0,
      read_back: "not_requested",
      last_error_code: null,
      opt_out_reason: null,
    },
    artifacts: [
      {
        logical_name: "calibration_diagnostics",
        artifact_kind: "aggregate_diagnostics",
        contract_relative_path: "artifacts/calibration_diagnostics.json",
        media_type: "application/json",
        sha256: "a".repeat(64),
        classification: "aggregate",
      },
    ],
    failure: null,
    paths: {
      progress: `runs/${runId}/progress.json`,
      events: `runs/${runId}/events.ndjson`,
      calibration_progress: `runs/${runId}/calibration_progress.json`,
    },
  };
}

test("builds the calibration tree from a staging diagnostics artifact", async () => {
  const runId = "uk-fit-map";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith(`/runs/${runId}/run_manifest.json`)) {
      return Response.json(runManifest(runId));
    }
    if (url.endsWith(`/runs/${runId}/artifacts/calibration_diagnostics.json`)) {
      return Response.json({
        schema_version: 6,
        weight_entity: "household",
        options: {},
        n_nonzero: 2,
        n_records: 2,
        initial_loss: 0.2,
        final_loss: 0.05,
        fraction_within_10pct: 1,
        loss_trajectory: [0.2, 0.05],
        skipped: [],
        targets: [
          {
            name: "ons/employment_income/total@2025",
            target_name: "ons/employment_income/total",
            period: 2025,
            entity: "household",
            source: "ons",
            metadata: {
              variable: "employment_income",
              geography: "United Kingdom",
              geography_level: "national",
            },
            target: 100,
            initial_estimate: 80,
            final_estimate: 95,
            relative_error: -0.05,
            within_tolerance: true,
          },
        ],
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

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
