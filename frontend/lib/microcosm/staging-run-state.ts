// The run state the Staging page's Candidate tab shows. The tab lists runs
// from the Hugging Face staging repository, but a build's Hugging Face copy
// can stop changing partway through (a rate-limited writer switches its
// uploads off), while the telemetry collector keeps receiving events. So when
// the collector has a record of a run, its state replaces the Hugging Face
// one, derived exactly as the Build progress tab derives it; the Hugging Face
// values stay alongside for comparison. The one exception: a collector record
// that stopped before the run ended never hides an end the Hugging Face copy
// recorded after the record's latest update.
import {
  type BuildRunState,
  type BuildTimeline,
  FINAL_RUN_STATES,
  collectorMissedTheEnd,
  runState,
} from "@/lib/microcosm/build-monitor";
import type { StagingRunSummary } from "@policyengine/calibration-tree/staging-artifact";

export type RunStateSource = "collector" | "hugging_face";

// An unfinished run's events and calibration events from the collector's
// record are kept newest first up to this many characters of JSON each, so
// the Candidate tab's answer stays well within the platform's 4.5 MB
// response limit. A record can hold far more than a run's copied files.
export const RECORD_EVENTS_JSON_LIMIT = 1_500_000;

type JsonDocument = Record<string, unknown>;

function jsonObject(value: unknown): JsonDocument | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonDocument)
    : null;
}

// A heartbeat as the collector serves it in a run's documents: a `progress`
// event that is not a calibration event and carries the emitter's machine
// reading or, from emitters before 0.14.0, no message and no details beside
// its resource sample. It names the stage the run is in. A run's own events
// file never holds one. (A heartbeat whose reading the collector dropped
// looks like an older emitter's and is left out the same way only when it
// has no message.)
function isHeartbeat(event: JsonDocument): boolean {
  if (event.event_type === "calibration" || event.status !== "progress") return false;
  const details = jsonObject(event.details);
  if (jsonObject(details?.reading)) return true;
  const message = typeof event.message === "string" ? event.message.trim() : "";
  return (
    message === "" &&
    (details == null || Object.keys(details).length === 0) &&
    event.resources != null
  );
}

// The newest items whose JSON fits the limit, in their order.
function newestWithin<T>(items: readonly T[]): T[] {
  // The brackets, less the comma the first item has none of.
  let size = 1;
  let first = items.length;
  while (first > 0) {
    const itemSize = JSON.stringify(items[first - 1]).length + 1;
    if (size + itemSize > RECORD_EVENTS_JSON_LIMIT) break;
    size += itemSize;
    first -= 1;
  }
  return items.slice(first);
}

/**
 * An unfinished run's Stage timeline events and calibration progress, from
 * the collector's record: heartbeats left out, and the newest of each kept
 * within `RECORD_EVENTS_JSON_LIMIT`.
 */
export function recordInternals(record: {
  events: JsonDocument[];
  calibration_progress: JsonDocument | null;
}): { events: JsonDocument[]; calibration_progress: JsonDocument | null } {
  const events = newestWithin(record.events.filter((event) => !isHeartbeat(event)));
  const calibration = record.calibration_progress;
  const calibrationEvents = Array.isArray(calibration?.events) ? calibration.events : null;
  return {
    events,
    calibration_progress:
      calibration && calibrationEvents
        ? { ...calibration, events: newestWithin(calibrationEvents) }
        : calibration,
  };
}

export interface CalibrationEpoch {
  epoch: number | null;
  epochs: number | null;
}

// What the run's Hugging Face copy records.
export interface HuggingFaceRunState {
  status: string | null;
  stage: string | null;
  started_at: string | null;
  updated_at: string | null;
  calibration?: CalibrationEpoch | null;
}

export interface CandidateRunFailure {
  // The stage that failed, or the acceptance check stage that refused the
  // candidate.
  stage: string | null;
  message: string | null;
}

export interface CandidateRunState {
  // "collector" when the collector has a record of the run, unless that
  // record stopped before the run ended and the Hugging Face copy recorded the
  // end later.
  state_source: RunStateSource;
  // Null only when the Hugging Face copy records no status.
  status: BuildRunState | null;
  // The current stage; for a failed or refused run, the stage it stopped at.
  stage: string | null;
  started_at: string | null;
  // The run's latest event, heartbeat or upload.
  updated_at: string | null;
  ended_at: string | null;
  heartbeat_at: string | null;
  failure: CandidateRunFailure | null;
  calibration: CalibrationEpoch | null;
  hugging_face_status: string | null;
  hugging_face_stage: string | null;
  hugging_face_updated_at: string | null;
  // The Hugging Face copy shows another state, or is well behind the
  // collector's record. Always false when the state comes from Hugging Face.
  hugging_face_differs: boolean;
}

export type CandidateRunSummary = StagingRunSummary & CandidateRunState;

// How far the Hugging Face copy may trail the collector's record before the
// page says so. Staging writers upload the copy only when the build records
// something, at most every 5 minutes for the UK writer, while the collector
// gets a heartbeat every minute. So a copy this far behind has either stopped
// changing or is in a long stage with nothing new to upload; either way the
// page shows what the copy still records.
export const HUGGING_FACE_LAG_MS = 15 * 60 * 1000;

function timeMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isoTime(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

function huggingFaceState(
  huggingFace: HuggingFaceRunState,
  nowMs: number,
): BuildRunState | null {
  return huggingFace.status == null
    ? null
    : runState(huggingFace.status, timeMs(huggingFace.updated_at), nowMs);
}

// Whether a run's Hugging Face status records that the run ended. A run
// without one may have ended all the same, and only the collector can say so.
export function huggingFaceRecordsAnEnd(status: string | null): boolean {
  return status != null && FINAL_RUN_STATES.has(runState(status, null, 0));
}

function lastCalibrationEpoch(timeline: BuildTimeline): CalibrationEpoch | null {
  const last = timeline.calibration.at(-1);
  return last ? { epoch: last.epoch, epochs: last.epochs } : null;
}

export function candidateRunState(
  huggingFace: HuggingFaceRunState,
  collector: BuildTimeline | undefined,
  nowMs: number,
): CandidateRunState {
  const huggingFaceValues = {
    hugging_face_status: huggingFace.status,
    hugging_face_stage: huggingFace.stage,
    hugging_face_updated_at: huggingFace.updated_at,
  };
  const huggingFaceStatus = huggingFaceState(huggingFace, nowMs);
  const huggingFaceUpdatedMs = timeMs(huggingFace.updated_at);
  if (
    !collector ||
    collectorMissedTheEnd(collector, {
      state: huggingFaceStatus,
      updated_ms: huggingFaceUpdatedMs,
    })
  ) {
    return {
      state_source: "hugging_face",
      status: huggingFaceStatus,
      stage: huggingFace.stage,
      started_at: huggingFace.started_at,
      updated_at: huggingFace.updated_at,
      ended_at: null,
      heartbeat_at: null,
      failure: null,
      calibration: huggingFace.calibration ?? null,
      ...huggingFaceValues,
      hugging_face_differs: false,
    };
  }
  const huggingFaceLagMs =
    collector.updated_ms != null && huggingFaceUpdatedMs != null
      ? collector.updated_ms - huggingFaceUpdatedMs
      : null;
  return {
    state_source: "collector",
    status: collector.state,
    stage: collector.failure?.stage ?? collector.current_stage,
    started_at: isoTime(collector.started_ms),
    updated_at: isoTime(collector.updated_ms),
    ended_at: isoTime(collector.ended_ms),
    heartbeat_at: isoTime(collector.heartbeat_ms),
    failure: collector.failure
      ? { stage: collector.failure.stage, message: collector.failure.message }
      : null,
    calibration: lastCalibrationEpoch(collector),
    ...huggingFaceValues,
    hugging_face_differs:
      huggingFaceStatus !== collector.state ||
      huggingFaceLagMs == null ||
      huggingFaceLagMs > HUGGING_FACE_LAG_MS,
  };
}

// A Hugging Face run summary with the collector's state laid over it.
export function overlayRunSummary(
  summary: StagingRunSummary,
  collector: BuildTimeline | undefined,
  nowMs: number,
): CandidateRunSummary {
  return {
    ...summary,
    ...candidateRunState(
      {
        status: summary.status,
        stage: summary.stage,
        started_at: summary.started_at,
        updated_at: summary.updated_at,
      },
      collector,
      nowMs,
    ),
  };
}
