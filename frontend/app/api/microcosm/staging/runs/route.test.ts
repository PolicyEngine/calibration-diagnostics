import { expect, test } from "bun:test";

import {
  type BuildTimeline,
  buildTimeline,
} from "@/lib/microcosm/build-monitor";
import type { CollectorTimelines } from "@/lib/microcosm/build-runs";
import {
  INVESTIGATION_NOW_MS,
  UK_BLOCKED_RUN_ID,
  UK_COMPLETED_HUGGING_FACE_RUN_ID,
  US_ABANDONED_HUGGING_FACE_RUN_ID,
  US_FAILED_RUN_ID,
  US_FINISHED_HUGGING_FACE_RUN_ID,
  US_RUNNING_RUN_ID,
  ukBlockedCollectorDocuments,
  ukHuggingFaceRuns,
  usFailedCollectorDocuments,
  usHuggingFaceRuns,
  usRunningCollectorDocuments,
} from "@/lib/microcosm/test-support/collector-run-fixtures";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import type { StagingRunSummary } from "@policyengine/calibration-tree/staging-artifact";
import { createStagingRunsHandler } from "./route";

type RunList = {
  available: boolean;
  source_repo: string;
  revision: string;
  truncated: boolean;
  runs: StagingRunSummary[];
  incompatible_runs: never[];
};

function huggingFaceList(runs: StagingRunSummary[]): RunList {
  return {
    available: true,
    source_repo: "policyengine/populace-us-staging",
    revision: "main",
    truncated: false,
    runs,
    incompatible_runs: [],
  };
}

function handler(
  list: RunList,
  collector: (runIds: readonly string[]) => Promise<CollectorTimelines>,
) {
  const collectorRequests: { country: MicrocosmCountry; runIds: readonly string[] }[] = [];
  const get = createStagingRunsHandler({
    loadRuns: async () => list,
    loadCollectorTimelines: async (country, runIds) => {
      collectorRequests.push({ country, runIds });
      return collector(runIds);
    },
    now: () => INVESTIGATION_NOW_MS,
  });
  return { get, collectorRequests };
}

function timelines(...entries: BuildTimeline[]): Map<string, BuildTimeline> {
  return new Map(entries.map((timeline) => [timeline.run_id, timeline]));
}

async function listRuns(get: (request: Request) => Promise<Response>, country: string) {
  const response = await get(
    new Request(`http://dashboard.test/api/microcosm/staging/runs?country=${country}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    available: boolean;
    collector_note: string | null;
    runs: (StagingRunSummary & Record<string, unknown>)[];
  };
}

function byRunId(runs: Record<string, unknown>[]) {
  return Object.fromEntries(runs.map((run) => [run.run_id, run]));
}

test("US runs take the collector's state when the collector has their record", async () => {
  const { get, collectorRequests } = handler(
    huggingFaceList(usHuggingFaceRuns()),
    async () => ({
      timelines: timelines(
        buildTimeline(usFailedCollectorDocuments(), INVESTIGATION_NOW_MS),
        buildTimeline(usRunningCollectorDocuments(), INVESTIGATION_NOW_MS),
      ),
      note: null,
    }),
  );

  const body = await listRuns(get, "us");
  const runs = byRunId(body.runs);

  expect(collectorRequests).toEqual([
    {
      country: "us",
      runIds: [
        US_RUNNING_RUN_ID,
        US_FAILED_RUN_ID,
        US_ABANDONED_HUGGING_FACE_RUN_ID,
        US_FINISHED_HUGGING_FACE_RUN_ID,
      ],
    },
  ]);
  expect(body.collector_note).toBeNull();
  // Hugging Face's order and run list are kept.
  expect(body.runs.map((run) => run.run_id)).toEqual(
    usHuggingFaceRuns().map((run) => run.run_id),
  );
  expect(runs[US_FAILED_RUN_ID]).toMatchObject({
    state_source: "collector",
    status: "failed",
    stage: "release_gates",
    ended_at: "2026-10-20T06:37:45.000Z",
    hugging_face_status: "running",
    hugging_face_stage: "calibrating",
    hugging_face_updated_at: "2026-10-20T06:09:35+00:00",
  });
  expect(runs[US_RUNNING_RUN_ID]).toMatchObject({
    state_source: "collector",
    status: "running",
    stage: "reform_validation",
    heartbeat_at: "2026-10-22T17:16:45.000Z",
    hugging_face_stage: "calibrating",
    hugging_face_updated_at: "2026-10-21T18:59:03+00:00",
  });
  expect(runs[US_FINISHED_HUGGING_FACE_RUN_ID]).toMatchObject({
    state_source: "hugging_face",
    status: "passed",
    stage: "complete",
  });
});

test("runs only the collector knows are not added to the Candidate list", async () => {
  const collectorOnly = buildTimeline(
    { ...usRunningCollectorDocuments(), run_id: "collector-only-run" },
    INVESTIGATION_NOW_MS,
  );
  const { get } = handler(huggingFaceList(usHuggingFaceRuns()), async () => ({
    timelines: timelines(collectorOnly),
    note: null,
  }));

  const body = await listRuns(get, "us");

  expect(body.runs.map((run) => run.run_id)).not.toContain("collector-only-run");
  expect(body.runs).toHaveLength(usHuggingFaceRuns().length);
});

test("a collector failure returns the Hugging Face states with a note", async () => {
  const note =
    "The telemetry collector could not be read (Telemetry collector request failed (503).), so run states come from the Hugging Face staging repository.";
  const { get } = handler(huggingFaceList(usHuggingFaceRuns()), async () => ({
    timelines: new Map(),
    note,
  }));

  const body = await listRuns(get, "us");
  const runs = byRunId(body.runs);

  expect(body.available).toBe(true);
  expect(body.collector_note).toBe(note);
  expect(runs[US_FAILED_RUN_ID]).toMatchObject({
    state_source: "hugging_face",
    status: "stalled",
    stage: "calibrating",
    updated_at: "2026-10-20T06:09:35+00:00",
    hugging_face_status: "running",
  });
});

test("a UK list overlays the collector's record and keeps Hugging Face-only runs", async () => {
  const { get, collectorRequests } = handler(
    { ...huggingFaceList(ukHuggingFaceRuns()), source_repo: "policyengine/populace-uk-staging" },
    async () => ({
      timelines: timelines(
        buildTimeline(ukBlockedCollectorDocuments(), INVESTIGATION_NOW_MS),
      ),
      note: null,
    }),
  );

  const body = await listRuns(get, "uk");
  const runs = byRunId(body.runs);

  expect(collectorRequests.map((request) => request.country)).toEqual(["uk"]);
  expect(runs[UK_BLOCKED_RUN_ID]).toMatchObject({
    state_source: "collector",
    status: "blocked",
    stage: "gate_battery",
    hugging_face_differs: false,
  });
  expect(runs[UK_COMPLETED_HUGGING_FACE_RUN_ID]).toMatchObject({
    state_source: "hugging_face",
    status: "passed",
    hugging_face_status: "completed",
  });
});

test("an unreadable staging repository asks the collector nothing", async () => {
  const { get, collectorRequests } = handler(
    { ...huggingFaceList([]), available: false },
    async () => {
      throw new Error("The collector must not be asked.");
    },
  );

  const body = await listRuns(get, "us");

  expect(body.available).toBe(false);
  expect(body.collector_note).toBeNull();
  expect(collectorRequests).toEqual([]);
});
