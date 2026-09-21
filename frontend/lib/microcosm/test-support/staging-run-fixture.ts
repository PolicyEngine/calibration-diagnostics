// Test support: a version 2 staging run whose calibration diagnostics were
// uploaded with its telemetry, and a fetch stub serving it. Shared by the
// route tests that review a candidate through the release pages.
import { createHash } from "node:crypto";

export const STAGING_FIXTURE_COUNTRY = "uk";

export function stagingRunManifest(
  runId: string,
  diagnosticsSha256: string | null,
): Record<string, unknown> {
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
    artifacts:
      diagnosticsSha256 == null
        ? []
        : [
            {
              logical_name: "calibration_diagnostics",
              artifact_kind: "aggregate_diagnostics",
              contract_relative_path: "artifacts/calibration_diagnostics.json",
              media_type: "application/json",
              sha256: diagnosticsSha256,
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

export function stagingDiagnosticsFixture(): Record<string, unknown> {
  return {
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
  };
}

/**
 * A fetch stub for one staging run: its run manifest and, when diagnostics
 * are given, the telemetry diagnostics artifact. Everything else is a 404,
 * so a release-repository read fails loudly.
 */
export function stagingTelemetryFetch(
  runId: string,
  diagnostics: Record<string, unknown> | null,
): typeof fetch {
  const body = diagnostics == null ? null : JSON.stringify(diagnostics);
  const sha256 = body == null ? null : createHash("sha256").update(body).digest("hex");
  return (async (input) => {
    const url = String(input);
    if (url.endsWith(`/runs/${runId}/run_manifest.json`)) {
      return Response.json(stagingRunManifest(runId, sha256));
    }
    if (body != null && url.endsWith(`/runs/${runId}/artifacts/calibration_diagnostics.json`)) {
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}
