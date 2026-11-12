// A run from the collector's read API v2 (`GET /v2/runs/{run_id}`), turned
// into the documents read API v1 gives for it (`GET /v1/runs/{run_id}`): the
// shape of the run files builds wrote to Hugging Face, which the build monitor
// reads. It does what the collector's `run_documents`
// (`telemetry_collector/storage.py` in PolicyEngine/microcosm-collector)
// does with the same state and events.
//
// Two differences remain, and the build monitor reads past both:
// - v2 writes every time as `...Z`, where v1 keeps the `+00:00` of the times
//   nested in a run's `work` and `reading`;
// - v2's response models write every field, so an optional field a producer
//   left out (such as one of `resources`' fields) is null here where v1 leaves
//   it out.
//
// The documents share objects with the answer they are made from; nothing
// keeps that answer, so nothing is copied.
import type {
  RawEvent,
  RunDetail,
} from "@policyengine/microcosm-collector-client";

type JsonObject = Record<string, unknown>;

export interface CollectorRunDocuments {
  progress: JsonObject;
  run_manifest: JsonObject;
  calibration_progress: JsonObject | null;
  events: JsonObject[];
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lifecycleEvent(event: RawEvent, sequence: number): JsonObject {
  return {
    schema_version: 2,
    sequence,
    timestamp: event.timestamp,
    time: event.timestamp,
    event_type: event.event_type === "calibration" ? "calibration" : "stage",
    run_id: event.run_id,
    stage_id: event.stage_id,
    stage: event.stage_id,
    status: event.status,
    message: event.message,
    details: event.details,
    resources: event.resources,
    producer_id: event.producer_id,
    event_id: event.event_id,
  };
}

export function runDocuments(detail: RunDetail): CollectorRunDocuments {
  const { run, events } = detail;
  let identity: JsonObject | null = null;
  const calibrationEvents: JsonObject[] = [];
  for (const event of events) {
    if (event.event_type === "run" && isObject(event.details.identity)) {
      identity = event.details.identity;
    }
    if (event.event_type === "calibration") {
      calibrationEvents.push({
        time: event.timestamp,
        timestamp: event.timestamp,
        ...event.details,
      });
    }
  }

  const common: JsonObject = {
    schema_version: 2,
    run_id: run.run_id,
    country_code: run.country_code,
    operation_id: run.run_id,
    pipeline: { id: run.pipeline, version: "collector-v1" },
    candidate_id: run.candidate_id,
    release_id: run.release_id,
    run_kind: run.run_kind,
    non_release: run.release_id === null,
    started_at: run.started_at,
    updated_at: run.updated_at,
    status: run.status,
    current_stage: run.current_stage,
  };
  return {
    progress: {
      ...common,
      heartbeat_at: run.heartbeat_at,
      resources: run.resources,
      reading: run.reading,
      work: run.work,
      failure: run.failure,
      block: run.block,
    },
    run_manifest: {
      ...common,
      identity,
      environment: run.environment,
      failure: run.failure,
      block: run.block,
      delivery: {
        mode: "collector",
        upload_attempts: null,
        upload_successes: null,
      },
    },
    calibration_progress: calibrationEvents.length
      ? {
          schema_version: 2,
          run_id: run.run_id,
          candidate_id: run.candidate_id,
          updated_at: run.updated_at,
          events: calibrationEvents,
        }
      : null,
    events: events.map((event, index) => lifecycleEvent(event, index + 1)),
  };
}
