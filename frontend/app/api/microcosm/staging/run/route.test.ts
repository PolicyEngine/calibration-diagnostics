import { expect, test } from "bun:test";

import { buildTimeline } from "@/lib/microcosm/build-monitor";
import type { CollectorTimelines } from "@/lib/microcosm/build-runs";
import {
  INVESTIGATION_NOW_MS,
  US_FAILED_RUN_ID,
  US_RELEASE_CHECK_FAILURE,
  usFailedCollectorDocuments,
} from "@/lib/microcosm/test-support/collector-run-fixtures";
import type { StagingRunDetail } from "@policyengine/calibration-tree/staging-artifact";
import { createStagingRunHandler } from "./route";

// The failed US run's Hugging Face copy: its last upload, mid-calibration.
function huggingFaceDetail(): StagingRunDetail {
  return {
    available: true,
    source_repo: "policyengine/populace-us-staging",
    revision: "main",
    run_id: US_FAILED_RUN_ID,
    candidate_release_id: US_FAILED_RUN_ID,
    release_id: null,
    country_code: "US",
    run_kind: null,
    non_release: null,
    schema_version: 1,
    delivery: null,
    progress: {
      schema_version: 1,
      run_id: US_FAILED_RUN_ID,
      status: "running",
      stage: "calibrating",
      started_at: "2026-10-19T22:25:40+00:00",
      updated_at: "2026-10-20T06:09:35+00:00",
      calibration: { epoch: 273, epochs: 1500 },
    },
    run_manifest: null,
    calibration_progress: null,
    events: [],
    has_calibration: false,
    calibration: null,
    reform_validation: null,
    build_manifest: null,
    release_manifest: null,
  };
}

function handler(collector: () => Promise<CollectorTimelines>) {
  const collectorRequests: (readonly string[])[] = [];
  const get = createStagingRunHandler({
    loadRun: async () => huggingFaceDetail(),
    loadCollectorTimelines: async (_country, runIds) => {
      collectorRequests.push(runIds);
      return collector();
    },
    now: () => INVESTIGATION_NOW_MS,
  });
  return { get, collectorRequests };
}

async function loadRun(get: (request: Request) => Promise<Response>) {
  const response = await get(
    new Request(
      `http://dashboard.test/api/microcosm/staging/run?country=us&id=${US_FAILED_RUN_ID}`,
    ),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as StagingRunDetail & {
    state: Record<string, unknown>;
    collector_note: string | null;
  };
}

test("the selected run's state comes from the collector, with the Hugging Face copy kept", async () => {
  const { get, collectorRequests } = handler(async () => ({
    timelines: new Map([
      [
        US_FAILED_RUN_ID,
        buildTimeline(usFailedCollectorDocuments(), INVESTIGATION_NOW_MS),
      ],
    ]),
    note: null,
  }));

  const body = await loadRun(get);

  expect(collectorRequests).toEqual([[US_FAILED_RUN_ID]]);
  expect(body.collector_note).toBeNull();
  // The Hugging Face documents are returned unchanged.
  expect(body.progress).toMatchObject({ status: "running", stage: "calibrating" });
  expect(body.state).toMatchObject({
    state_source: "collector",
    status: "failed",
    stage: "release_gates",
    ended_at: "2026-10-20T06:37:45.000Z",
    failure: { stage: "release_gates", message: US_RELEASE_CHECK_FAILURE },
    hugging_face_status: "running",
    hugging_face_stage: "calibrating",
    hugging_face_updated_at: "2026-10-20T06:09:35+00:00",
    hugging_face_differs: true,
  });
});

test("a collector failure returns the Hugging Face state with a note", async () => {
  const note =
    "The telemetry collector could not be read (Telemetry collector request failed (503).), so run states come from the Hugging Face staging repository.";
  const { get } = handler(async () => ({ timelines: new Map(), note }));

  const body = await loadRun(get);

  expect(body.collector_note).toBe(note);
  expect(body.state).toMatchObject({
    state_source: "hugging_face",
    status: "stalled",
    stage: "calibrating",
    updated_at: "2026-10-20T06:09:35+00:00",
    calibration: { epoch: 273, epochs: 1500 },
    failure: null,
  });
});

test("a run the collector does not know keeps its Hugging Face state without a note", async () => {
  const { get } = handler(async () => ({ timelines: new Map(), note: null }));

  const body = await loadRun(get);

  expect(body.collector_note).toBeNull();
  expect(body.state).toMatchObject({
    state_source: "hugging_face",
    status: "stalled",
    hugging_face_differs: false,
  });
});
