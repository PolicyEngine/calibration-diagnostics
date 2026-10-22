import { describe, expect, test } from "bun:test";

import { buildTimeline } from "@/lib/microcosm/build-monitor";
import {
  candidateRunState,
  overlayRunSummary,
} from "@/lib/microcosm/staging-run-state";
import {
  INVESTIGATION_NOW_MS,
  UK_BLOCKED_RUN_ID,
  UK_COMPLETED_HUGGING_FACE_RUN_ID,
  US_ABANDONED_HUGGING_FACE_RUN_ID,
  US_FAILED_RUN_ID,
  US_FINISHED_HUGGING_FACE_RUN_ID,
  US_RELEASE_CHECK_FAILURE,
  US_RUNNING_RUN_ID,
  ukBlockedCollectorDocuments,
  ukHuggingFaceRuns,
  usFailedCollectorDocuments,
  usHuggingFaceRuns,
  usRunningCollectorDocuments,
} from "@/lib/microcosm/test-support/collector-run-fixtures";

function usSummary(runId: string) {
  return usHuggingFaceRuns().find((run) => run.run_id === runId)!;
}

function ukSummary(runId: string) {
  return ukHuggingFaceRuns().find((run) => run.run_id === runId)!;
}

describe("a run the collector has a record of", () => {
  test("the US run that failed its release acceptance checks shows as failed", () => {
    const collectorTimeline = buildTimeline(
      usFailedCollectorDocuments(),
      INVESTIGATION_NOW_MS,
    );

    const overlaid = overlayRunSummary(
      usSummary(US_FAILED_RUN_ID),
      collectorTimeline,
      INVESTIGATION_NOW_MS,
    );

    expect(overlaid).toMatchObject({
      run_id: US_FAILED_RUN_ID,
      candidate_release_id: US_FAILED_RUN_ID,
      state_source: "collector",
      status: "failed",
      stage: "release_gates",
      started_at: "2026-10-19T22:23:36.000Z",
      updated_at: "2026-10-20T06:37:45.000Z",
      ended_at: "2026-10-20T06:37:45.000Z",
      heartbeat_at: "2026-10-20T06:37:43.000Z",
      failure: { stage: "release_gates", message: US_RELEASE_CHECK_FAILURE },
      hugging_face_status: "running",
      hugging_face_stage: "calibrating",
      hugging_face_updated_at: "2026-10-20T06:09:35+00:00",
      hugging_face_differs: true,
    });
  });

  test("the US run in reform validation shows as running in that stage", () => {
    const collectorTimeline = buildTimeline(
      usRunningCollectorDocuments(),
      INVESTIGATION_NOW_MS,
    );

    const overlaid = overlayRunSummary(
      usSummary(US_RUNNING_RUN_ID),
      collectorTimeline,
      INVESTIGATION_NOW_MS,
    );

    expect(overlaid).toMatchObject({
      state_source: "collector",
      status: "running",
      stage: "reform_validation",
      started_at: "2026-10-21T16:02:20.000Z",
      updated_at: "2026-10-22T17:16:47.000Z",
      ended_at: null,
      heartbeat_at: "2026-10-22T17:16:45.000Z",
      failure: null,
      hugging_face_status: "running",
      hugging_face_stage: "calibrating",
      hugging_face_updated_at: "2026-10-21T18:59:03+00:00",
      hugging_face_differs: true,
    });
  });

  test("the collector's 5-minute heartbeat rule marks a silent running run stalled", () => {
    const sixMinutesAfterHeartbeat = Date.parse("2026-10-22T17:22:45Z");
    const collectorTimeline = buildTimeline(
      usRunningCollectorDocuments(),
      sixMinutesAfterHeartbeat,
    );

    const overlaid = overlayRunSummary(
      usSummary(US_RUNNING_RUN_ID),
      collectorTimeline,
      sixMinutesAfterHeartbeat,
    );

    expect(overlaid.status).toBe("stalled");
    expect(overlaid.state_source).toBe("collector");
  });

  test("a UK run whose Hugging Face copy is current keeps the same state", () => {
    const collectorTimeline = buildTimeline(
      ukBlockedCollectorDocuments(),
      INVESTIGATION_NOW_MS,
    );

    const overlaid = overlayRunSummary(
      ukSummary(UK_BLOCKED_RUN_ID),
      collectorTimeline,
      INVESTIGATION_NOW_MS,
    );

    expect(overlaid).toMatchObject({
      state_source: "collector",
      status: "blocked",
      stage: "gate_battery",
      ended_at: "2026-10-18T23:45:50.000Z",
      hugging_face_status: "blocked",
      hugging_face_updated_at: "2026-10-18T23:45:45+00:00",
      hugging_face_differs: false,
    });
    expect(overlaid.failure?.stage).toBe("gate_battery");
    expect(overlaid.failure?.message).toContain("3 blocking failures");
  });
});

describe("a run the collector has no record of", () => {
  test("keeps its Hugging Face state, with the shared 6-hour rule for silent runs", () => {
    const abandoned = overlayRunSummary(
      usSummary(US_ABANDONED_HUGGING_FACE_RUN_ID),
      undefined,
      INVESTIGATION_NOW_MS,
    );
    const finished = overlayRunSummary(
      usSummary(US_FINISHED_HUGGING_FACE_RUN_ID),
      undefined,
      INVESTIGATION_NOW_MS,
    );

    expect(abandoned).toMatchObject({
      state_source: "hugging_face",
      status: "stalled",
      stage: "base_population_repair",
      updated_at: "2026-07-02T13:48:44+00:00",
      ended_at: null,
      heartbeat_at: null,
      failure: null,
      hugging_face_status: "running",
      hugging_face_stage: "base_population_repair",
      hugging_face_updated_at: "2026-07-02T13:48:44+00:00",
      hugging_face_differs: false,
    });
    expect(finished).toMatchObject({
      state_source: "hugging_face",
      status: "passed",
      stage: "complete",
    });
  });

  test("a running Hugging Face run updated within 6 hours is still running", () => {
    const threeHoursLater = Date.parse("2026-10-20T09:09:35Z");

    const overlaid = overlayRunSummary(
      usSummary(US_FAILED_RUN_ID),
      undefined,
      threeHoursLater,
    );

    expect(overlaid).toMatchObject({
      state_source: "hugging_face",
      status: "running",
      stage: "calibrating",
    });
  });

  test("a UK local-area candidate that closed as completed shows as finished", () => {
    const overlaid = overlayRunSummary(
      ukSummary(UK_COMPLETED_HUGGING_FACE_RUN_ID),
      undefined,
      INVESTIGATION_NOW_MS,
    );

    expect(overlaid).toMatchObject({
      state_source: "hugging_face",
      status: "passed",
      hugging_face_status: "completed",
    });
  });

  test("a run with no recorded status stays unknown", () => {
    const state = candidateRunState(
      { status: null, stage: null, started_at: null, updated_at: null },
      undefined,
      INVESTIGATION_NOW_MS,
    );

    expect(state.status).toBeNull();
    expect(state.state_source).toBe("hugging_face");
  });
});

test("the Hugging Face calibration epoch is kept for a run the collector does not know", () => {
  const state = candidateRunState(
    {
      status: "running",
      stage: "calibrating",
      started_at: "2026-10-19T22:25:40+00:00",
      updated_at: "2026-10-20T06:09:35+00:00",
      calibration: { epoch: 273, epochs: 1500 },
    },
    undefined,
    Date.parse("2026-10-20T06:10:00Z"),
  );

  expect(state.calibration).toEqual({ epoch: 273, epochs: 1500 });
});
