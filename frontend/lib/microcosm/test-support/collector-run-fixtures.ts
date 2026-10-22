// Test support: runs from the 2026-10-22 investigation of the Staging page,
// as the Hugging Face staging repository lists them and as the telemetry
// collector rebuilds their documents. The two US runs stopped uploading to
// Hugging Face partway through calibration, so their Hugging Face copies are
// out of date; the UK run's copy is current.
import type { BuildRunDocuments } from "@/lib/microcosm/build-monitor";
import type { StagingRunSummary } from "@policyengine/calibration-tree/staging-artifact";

// Production time when the collector last heard from the running US run.
export const INVESTIGATION_NOW_MS = Date.parse("2026-10-22T17:18:00Z");

// Failed at its release acceptance checks on 10-20; Hugging Face still says
// it is calibrating.
export const US_FAILED_RUN_ID =
  "populace-us-2024-b5db384-8b0c1950b65f-20261019T222143Z";
// In reform validation with recent heartbeats; Hugging Face still says it is
// calibrating.
export const US_RUNNING_RUN_ID =
  "populace-us-2024-b5db384-8b0c1950b65f-20261021T160022Z";
// Runs the collector has no record of.
export const US_FINISHED_HUGGING_FACE_RUN_ID =
  "populace-us-2024-f0af251-0ad74ed34493-20260619T181855Z";
export const US_ABANDONED_HUGGING_FACE_RUN_ID =
  "us-2024-immigration-266-b-20260702T134743Z";
// Refused by its acceptance checks; both sources agree.
export const UK_BLOCKED_RUN_ID =
  "uk-local-candidate-f100-s42-20261018T161007Z-35fb4c89";
// One of the five schema 2 local-area candidates that closed as `completed`
// although their acceptance checks reported blocking failures. The collector
// has no record of it.
export const UK_COMPLETED_HUGGING_FACE_RUN_ID =
  "uk-local-candidate-f100-s42-20261007T120029Z-2ee47c99";

export const US_RELEASE_CHECK_FAILURE =
  "Release gates failed: Critical fiscal target 'ssa_supplement.cy2024.oasdi_ssi_payments.social_security_benefits.payment_amount@2024' (Social Security benefits) has relative_error=-0.0641635, exceeding 0.05";

export function huggingFaceSummary(
  runId: string,
  fields: Pick<
    StagingRunSummary,
    "schema_version" | "status" | "stage" | "started_at" | "updated_at"
  >,
): StagingRunSummary {
  return {
    run_id: runId,
    candidate_release_id: runId,
    release_id: null,
    country_code: null,
    run_kind: null,
    non_release: null,
    progress_path: `runs/${runId}/progress.json`,
    run_manifest_path: `runs/${runId}/run_manifest.json`,
    ...fields,
  };
}

// The US list as production served it, newest update first.
export function usHuggingFaceRuns(): StagingRunSummary[] {
  return [
    huggingFaceSummary(US_RUNNING_RUN_ID, {
      schema_version: 1,
      status: "running",
      stage: "calibrating",
      started_at: "2026-10-21T16:06:14+00:00",
      updated_at: "2026-10-21T18:59:03+00:00",
    }),
    huggingFaceSummary(US_FAILED_RUN_ID, {
      schema_version: 1,
      status: "running",
      stage: "calibrating",
      started_at: "2026-10-19T22:25:40+00:00",
      updated_at: "2026-10-20T06:09:35+00:00",
    }),
    huggingFaceSummary(US_ABANDONED_HUGGING_FACE_RUN_ID, {
      schema_version: 1,
      status: "running",
      stage: "base_population_repair",
      started_at: null,
      updated_at: "2026-07-02T13:48:44+00:00",
    }),
    huggingFaceSummary(US_FINISHED_HUGGING_FACE_RUN_ID, {
      schema_version: 1,
      status: "passed",
      stage: "complete",
      started_at: null,
      updated_at: "2026-06-19T18:38:51+00:00",
    }),
  ];
}

export function ukHuggingFaceRuns(): StagingRunSummary[] {
  return [
    huggingFaceSummary(UK_BLOCKED_RUN_ID, {
      schema_version: 3,
      status: "blocked",
      stage: "blocked",
      started_at: "2026-10-18T16:10:09+00:00",
      updated_at: "2026-10-18T23:45:45+00:00",
    }),
    huggingFaceSummary(UK_COMPLETED_HUGGING_FACE_RUN_ID, {
      schema_version: 2,
      status: "completed",
      stage: "complete",
      started_at: "2026-10-07T12:00:29+00:00",
      updated_at: "2026-10-07T20:43:34+00:00",
    }),
  ];
}

interface CollectorEvent {
  stage: string;
  status: string;
  time: string;
  message?: string;
  details?: Record<string, unknown>;
}

// Documents in the shape the collector's `GET /v1/runs/{run_id}` returns:
// version 2 lifecycle events rebuilt from the events the build sent.
function collectorDocuments(
  runId: string,
  country: string,
  progress: Record<string, unknown>,
  events: CollectorEvent[],
): BuildRunDocuments {
  return {
    run_id: runId,
    source: "staging",
    country,
    progress: { schema_version: 2, run_id: runId, ...progress },
    run_manifest: null,
    calibration_progress: null,
    events: events.map((event, index) => ({
      schema_version: 2,
      sequence: index + 1,
      run_id: runId,
      event_type: "stage",
      stage_id: event.stage,
      stage: event.stage,
      status: event.status,
      timestamp: event.time,
      time: event.time,
      message: event.message ?? null,
      details: event.details ?? {},
    })),
  };
}

export function usFailedCollectorDocuments(): BuildRunDocuments {
  return collectorDocuments(
    US_FAILED_RUN_ID,
    "us",
    {
      country_code: "US",
      pipeline: { id: "us-fiscal-refresh", version: "collector-v1" },
      started_at: "2026-10-19T22:23:36Z",
      updated_at: "2026-10-20T06:37:45Z",
      heartbeat_at: "2026-10-20T06:37:43Z",
      status: "failed",
      current_stage: "failed",
      failure: {
        message: US_RELEASE_CHECK_FAILURE,
        error_type: "ReleaseGateError",
        error_code: null,
        failure_class: null,
        failed_during: "release_gates",
      },
    },
    [
      { stage: "created", status: "started", time: "2026-10-19T22:23:36Z" },
      { stage: "calibration", status: "started", time: "2026-10-20T05:48:41Z" },
      { stage: "calibration", status: "completed", time: "2026-10-20T06:27:42Z" },
      { stage: "export_dataset", status: "started", time: "2026-10-20T06:37:31Z" },
      {
        stage: "release_gates",
        status: "failed",
        time: "2026-10-20T06:37:45Z",
        message: US_RELEASE_CHECK_FAILURE,
      },
      {
        stage: "failed",
        status: "failed",
        time: "2026-10-20T06:37:45Z",
        message: US_RELEASE_CHECK_FAILURE,
      },
    ],
  );
}

export function usRunningCollectorDocuments(): BuildRunDocuments {
  return collectorDocuments(
    US_RUNNING_RUN_ID,
    "us",
    {
      country_code: "US",
      pipeline: { id: "us-fiscal-refresh", version: "collector-v1" },
      started_at: "2026-10-21T16:02:20Z",
      updated_at: "2026-10-22T17:16:47Z",
      heartbeat_at: "2026-10-22T17:16:45Z",
      status: "running",
      current_stage: "reform_validation",
    },
    [
      { stage: "created", status: "started", time: "2026-10-21T16:02:20Z" },
      { stage: "calibration", status: "started", time: "2026-10-21T18:22:41Z" },
      { stage: "calibration", status: "completed", time: "2026-10-21T19:20:23Z" },
      { stage: "release_gates", status: "started", time: "2026-10-21T19:40:50Z" },
      { stage: "release_gates", status: "completed", time: "2026-10-21T19:40:56Z" },
      { stage: "export_dataset", status: "started", time: "2026-10-21T19:40:57Z" },
      { stage: "export_dataset", status: "completed", time: "2026-10-21T20:38:21Z" },
      { stage: "reform_validation", status: "started", time: "2026-10-22T10:12:02Z" },
    ],
  );
}

export function ukBlockedCollectorDocuments(): BuildRunDocuments {
  const block = {
    phase: "terminal",
    blocking_failure_count: 3,
    blocking_gate_ids: ["uk_target_fit", "uk_local_area_support", "uk_local_target_fit"],
  };
  return collectorDocuments(
    UK_BLOCKED_RUN_ID,
    "uk",
    {
      country_code: "GB",
      pipeline: { id: "uk-local-candidate", version: "collector-v1" },
      started_at: "2026-10-18T16:10:08Z",
      updated_at: "2026-10-18T23:45:50Z",
      heartbeat_at: "2026-10-18T23:45:02Z",
      status: "blocked",
      current_stage: "blocked",
      block,
    },
    [
      { stage: "created", status: "started", time: "2026-10-18T16:10:08Z" },
      { stage: "calibration", status: "started", time: "2026-10-18T18:00:00Z" },
      { stage: "calibration", status: "completed", time: "2026-10-18T23:30:00Z" },
      { stage: "gate_battery", status: "started", time: "2026-10-18T23:40:00Z" },
      {
        stage: "gate_battery",
        status: "completed",
        time: "2026-10-18T23:45:49Z",
        details: { blocking_failure_count: 3 },
      },
      { stage: "blocked", status: "blocked", time: "2026-10-18T23:45:50Z", details: block },
    ],
  );
}
