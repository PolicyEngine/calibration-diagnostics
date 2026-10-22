// The run state the Staging page's Candidate tab shows. The tab lists runs
// from the Hugging Face staging repository, but a build's Hugging Face copy
// can stop changing partway through (a rate-limited writer switches its
// uploads off), while the telemetry collector keeps receiving events. So when
// the collector has a record of a run, its state replaces the Hugging Face
// one, derived exactly as the Build progress tab derives it; the Hugging Face
// values stay alongside for comparison.
import {
  type BuildRunState,
  type BuildTimeline,
  runState,
} from "@/lib/microcosm/build-monitor";
import type { StagingRunSummary } from "@policyengine/calibration-tree/staging-artifact";

export type RunStateSource = "collector" | "hugging_face";

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

// A healthy UK run uploads its Hugging Face copy every 5 minutes and sends the
// collector a heartbeat every minute, so a copy this far behind has stopped
// changing.
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
  if (!collector) {
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
  const huggingFaceUpdatedMs = timeMs(huggingFace.updated_at);
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
