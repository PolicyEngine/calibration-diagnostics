// A run from the collector's read API v2 (`GET /v2/runs/{run_id}`), turned
// into the documents read API v1 gives for it (`GET /v1/runs/{run_id}`): the
// shape of the run files builds wrote to Hugging Face, which the build monitor
// reads. It does what the collector's `run_documents`
// (`telemetry_collector/storage.py` in PolicyEngine/microcosm-collector)
// does with the same state and events.
//
// Version 2 serves the run's `environment` and `reading` through response
// models, so a key a newer emitter adds that those models don't list is absent
// here, where version 1 kept it. The build monitor reads only listed keys.

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

function requireObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) {
    throw new Error(`Telemetry collector ${label} must be an object.`);
  }
  return value;
}

export function runDocuments(detail: JsonObject): CollectorRunDocuments {
  const run = requireObject(detail.run, "run state");
  if (!Array.isArray(detail.events)) {
    throw new Error("Telemetry collector run must contain an events array.");
  }
  const events = detail.events.map((event, index) =>
    requireObject(event, `event ${index}`),
  );

  const lifecycleEvents: JsonObject[] = [];
  const calibrationEvents: JsonObject[] = [];
  let identity: JsonObject | null = null;
  for (const [index, event] of events.entries()) {
    // A copy, so that nothing the build monitor does to the documents
    // changes the answer they were made from.
    const details: JsonObject = isObject(event.details)
      ? structuredClone(event.details)
      : {};
    if (event.event_type === "run" && isObject(details.identity)) {
      identity = structuredClone(details.identity);
    }
    const isCalibration = event.event_type === "calibration";
    lifecycleEvents.push({
      schema_version: 2,
      sequence: index + 1,
      timestamp: event.timestamp,
      time: event.timestamp,
      event_type: isCalibration ? "calibration" : "stage",
      run_id: event.run_id,
      stage_id: event.stage_id ?? null,
      stage: event.stage_id ?? null,
      status: event.status,
      message: event.message ?? null,
      details,
      resources: event.resources ?? null,
      producer_id: event.producer_id,
      event_id: event.event_id,
    });
    if (isCalibration) {
      calibrationEvents.push({
        time: event.timestamp,
        timestamp: event.timestamp,
        ...structuredClone(details),
      });
    }
  }

  const releaseId = run.release_id ?? null;
  const common: JsonObject = {
    schema_version: 2,
    run_id: run.run_id,
    country_code: run.country_code,
    operation_id: run.run_id,
    pipeline: { id: run.pipeline, version: "collector-v1" },
    candidate_id: run.candidate_id ?? null,
    release_id: releaseId,
    run_kind: run.run_kind,
    non_release: releaseId === null,
    started_at: run.started_at,
    updated_at: run.updated_at,
    status: run.status,
    current_stage: run.current_stage,
  };
  const failure = structuredClone(run.failure ?? null);
  const block = structuredClone(run.block ?? null);
  return {
    progress: {
      ...common,
      heartbeat_at: run.heartbeat_at ?? null,
      resources: structuredClone(run.resources ?? null),
      reading: structuredClone(run.reading ?? null),
      work: structuredClone(run.work ?? null),
      failure,
      block,
    },
    run_manifest: {
      ...structuredClone(common),
      identity,
      environment: structuredClone(run.environment ?? null),
      failure: structuredClone(failure),
      block: structuredClone(block),
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
          candidate_id: run.candidate_id ?? null,
          updated_at: run.updated_at,
          events: calibrationEvents,
        }
      : null,
    events: lifecycleEvents,
  };
}
