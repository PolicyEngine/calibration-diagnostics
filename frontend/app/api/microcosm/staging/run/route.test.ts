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

test("the collector is told whether the selected run's Hugging Face copy records an end", async () => {
  async function unfinishedRunIdsFor(status: string) {
    const requested: (readonly string[] | undefined)[] = [];
    const detail = huggingFaceDetail();
    const get = createStagingRunHandler({
      loadRun: async () => ({
        ...detail,
        progress: { ...detail.progress, status },
      }),
      loadCollectorTimelines: async (_country, _runIds, _nowMs, options) => {
        requested.push(options?.unfinishedRunIds);
        return { timelines: new Map(), note: null };
      },
      now: () => INVESTIGATION_NOW_MS,
    });
    await loadRun(get);
    return requested;
  }

  expect(await unfinishedRunIdsFor("running")).toEqual([[US_FAILED_RUN_ID]]);
  expect(await unfinishedRunIdsFor("failed")).toEqual([[]]);
  expect(await unfinishedRunIdsFor("completed")).toEqual([[]]);
});

// A copy records a run's files only when the run writes them, so while it
// records no end, the Stage timeline and Calibration progress come from the
// collector's record (read API v2). The run manifest, which lists the uploaded
// files, and the copy's progress document stay.
function handlerWithRecord(copyStatus: string) {
  const detail = huggingFaceDetail();
  const record = usFailedCollectorDocuments();
  return createStagingRunHandler({
    loadRun: async () => ({
      ...detail,
      progress: { ...detail.progress, status: copyStatus },
      run_manifest: { schema_version: 1, run_id: US_FAILED_RUN_ID, artifacts: { a: {} } },
      events: [{ stage: "copied-event" }],
      calibration_progress: { schema_version: 1, events: [{ epoch: 1, loss: 9 }] },
    }),
    loadCollectorTimelines: async () => ({
      timelines: new Map([[US_FAILED_RUN_ID, buildTimeline(record, INVESTIGATION_NOW_MS)]]),
      documents: new Map([[US_FAILED_RUN_ID, record]]),
      note: null,
    }),
    now: () => INVESTIGATION_NOW_MS,
  });
}

test("an unfinished run's stage events and calibration progress come from the collector's record", async () => {
  const record = usFailedCollectorDocuments();

  const body = (await loadRun(handlerWithRecord("running"))) as unknown as Record<string, unknown>;

  expect(body.run_internals_source).toBe("collector");
  expect(body.events).toEqual(JSON.parse(JSON.stringify(record.events)));
  expect(body.calibration_progress).toEqual(JSON.parse(JSON.stringify(record.calibration_progress)));
  expect(body.progress).toMatchObject({ status: "running", stage: "calibrating" });
  expect(body.run_manifest).toMatchObject({ artifacts: { a: {} } });
});

// Heartbeats as the collector serves them in a run's documents: `stage`
// events with status `progress` that name the stage, carrying the emitter's
// machine reading, or, from emitters before 0.14.0, only the resources.
function heartbeatEvent(index: number): Record<string, unknown> {
  return {
    event_type: "stage",
    stage: "calibrating",
    stage_id: "calibrating",
    status: "progress",
    message: null,
    time: new Date(Date.parse("2026-10-20T00:00:00Z") + index * 30_000).toISOString(),
    resources: { rss_bytes: 1 },
    details:
      index % 2 === 0
        ? { reading: { interval_seconds: 30, late_seconds: 0, machine: { cpu_busy_share: 0.4 } } }
        : {},
  };
}

function handlerWithLargeRecord(events: Record<string, unknown>[], calibrationEvents: unknown[]) {
  const detail = huggingFaceDetail();
  const record = usFailedCollectorDocuments();
  const large = {
    ...record,
    events,
    calibration_progress: { ...record.calibration_progress, events: calibrationEvents },
  };
  return createStagingRunHandler({
    loadRun: async () => detail,
    loadCollectorTimelines: async () => ({
      timelines: new Map([[US_FAILED_RUN_ID, buildTimeline(record, INVESTIGATION_NOW_MS)]]),
      documents: new Map([[US_FAILED_RUN_ID, large]]),
      note: null,
    }),
    now: () => INVESTIGATION_NOW_MS,
  });
}

type RecordInternalsBody = {
  events: Record<string, unknown>[];
  calibration_progress: { events: { epoch: number }[] };
};

// Every emitter attaches a resource sample to every event.
const RESOURCES = { rss_bytes: 1 };

function minutesAfter(start: string, minutes: number): string {
  return new Date(Date.parse(start) + minutes * 60_000).toISOString();
}

// A stage start or end as the record's events list carries one.
function stageChange(index: number, stage = `stage-${index}`): Record<string, unknown> {
  return {
    event_type: "stage",
    stage,
    stage_id: stage,
    status: index % 2 === 0 ? "started" : "completed",
    message: `Stage ${stage}.`,
    time: minutesAfter("2026-10-23T15:00:00Z", index),
    details: {},
    resources: RESOURCES,
  };
}

// A US scoring-batch progress report as the record carries one: status
// `progress`, with the batch counts the build sent only to the emitter.
function scoringBatchReport(index: number): Record<string, unknown> {
  return {
    event_type: "stage",
    stage: "post_export_scoring",
    stage_id: "post_export_scoring",
    status: "progress",
    message: null,
    time: minutesAfter("2026-10-23T20:00:00Z", index / 12),
    details: {
      done: (index % 177) + 1,
      total: 177,
      unit: "scoring_batch",
      elapsed_seconds: index * 5.1,
      batch: index % 177,
      batches: 177,
      pass_name: "reform_coverage_smoke baseline plan",
      outer: { done: 1, total: 4, unit: "reform_pass" },
    },
    resources: { ...RESOURCES, cpu_user_seconds: index, cpu_system_seconds: index, peak_rss_bytes: 2 },
  };
}

// A UK graph-node progress report as the record carries one: status
// `completed`, with the node counts the build sent only to the emitter.
function graphNodeReport(done: number): Record<string, unknown> {
  return {
    event_type: "stage",
    stage: `uk.full.node-${done}`,
    stage_id: `uk.full.node-${done}`,
    status: "completed",
    message: null,
    time: minutesAfter("2026-11-23T08:00:00Z", done),
    details: { done, total: 25, unit: "graph_nodes", elapsed_seconds: 12.5 },
    resources: RESOURCES,
  };
}

// A calibration event as the record's events list carries one.
function calibrationEvent(epoch: number, padding = ""): Record<string, unknown> {
  return {
    event_type: "calibration",
    stage: "calibrating",
    stage_id: "calibrating",
    status: "progress",
    message: null,
    time: minutesAfter("2026-10-23T18:00:00Z", epoch / 60),
    details: { epoch, epochs: 1_500, loss: 0.2, padding },
    resources: RESOURCES,
  };
}

test("an unfinished run's events from the collector's record leave out heartbeats and progress reports", async () => {
  const stages = ["created", "target_compilation", "calibrating"].map((stage, index) =>
    stageChange(index, stage),
  );
  // A stage row the US build sent with a status the emitter doesn't know
  // (`retained`), which reaches the record as `progress`; the run's own
  // events file holds it.
  const retainedRow = {
    ...stageChange(1, "capital_gains_tail_presence"),
    status: "progress",
    message: "Retained the capital gains tail.",
    details: { retained_records: 12 },
  };
  // A stage update with a message and nothing else, as a stage transition
  // can send: neither a heartbeat nor a progress report.
  const stageUpdate = { ...stageChange(2, "calibrating"), status: "progress", message: "Fitting weights." };
  // A stage row whose details hold `done` but no `total`: not a progress
  // report.
  const doneOnly = { ...stageChange(3, "export_dataset"), details: { done: true } };
  // Nor is one whose details hold `total` but no `done`.
  const totalOnly = { ...stageChange(5, "export_dataset"), details: { total: 4 } };
  // A stage end the emitter adds when the next stage starts.
  const emitterStageEnd = {
    ...stageChange(1, "target_compilation"),
    message: null,
    details: { stage_span: { occurrence: 1, closed_by: "next_stage_started", awake_seconds: 60 } },
  };
  // A calibration event is never a progress report, whatever its details.
  const calibration = [calibrationEvent(1), { ...calibrationEvent(2), details: { done: 2, total: 9 } }];
  const heartbeats = Array.from({ length: 10 }, (_, index) => heartbeatEvent(index));

  const body = (await loadRun(
    handlerWithLargeRecord(
      [
        stages[0],
        ...heartbeats.slice(0, 5),
        retainedRow,
        stages[1],
        graphNodeReport(1),
        graphNodeReport(2),
        emitterStageEnd,
        stages[2],
        calibration[0],
        stageUpdate,
        calibration[1],
        scoringBatchReport(0),
        ...heartbeats.slice(5),
        scoringBatchReport(1),
        doneOnly,
        totalOnly,
      ],
      [],
    ),
  )) as unknown as RecordInternalsBody;

  // In the record's order, calibration events among the stage changes.
  expect(body.events).toEqual(
    JSON.parse(
      JSON.stringify([
        stages[0],
        retainedRow,
        stages[1],
        emitterStageEnd,
        stages[2],
        calibration[0],
        stageUpdate,
        calibration[1],
        doneOnly,
        totalOnly,
      ]),
    ),
  );
});

test("heartbeats whose reading the collector dropped are left out", async () => {
  // A heartbeat reading that doesn't match the collector's model (from an
  // emitter newer than the collector) is removed and named in
  // `dropped_emitter_details`; the heartbeat keeps any sleep it carries.
  const withoutReading = Array.from({ length: 4 }, (_, index) => ({
    ...heartbeatEvent(index),
    details:
      index % 2 === 0
        ? { dropped_emitter_details: ["reading"] }
        : { sleep: { asleep_seconds: 120 }, dropped_emitter_details: ["reading"] },
  }));
  // A stage end whose span the collector dropped is still a stage change.
  const stageEndWithoutSpan = {
    ...stageChange(1, "target_compilation"),
    details: { dropped_emitter_details: ["stage_span"] },
  };
  const stages = [stageChange(0, "created"), stageChange(2, "calibrating")];

  const body = (await loadRun(
    handlerWithLargeRecord(
      [stages[0], ...withoutReading.slice(0, 2), stageEndWithoutSpan, ...withoutReading.slice(2), stages[1]],
      [],
    ),
  )) as unknown as RecordInternalsBody;

  expect(body.events).toEqual(JSON.parse(JSON.stringify([stages[0], stageEndWithoutSpan, stages[1]])));
});

test("a long record's progress reports no longer crowd out the run's stages", async () => {
  // As the US run of 2026-10-23 recorded it: its stage changes, 1,500
  // calibration epochs, then thousands of scoring-batch progress reports
  // between its last stages, with heartbeats throughout.
  const stages = Array.from({ length: 42 }, (_, index) => stageChange(index));
  const calibration = Array.from({ length: 1_500 }, (_, index) => calibrationEvent(index + 1));
  const reports = Array.from({ length: 3_000 }, (_, index) => scoringBatchReport(index));
  const heartbeats = Array.from({ length: 400 }, (_, index) => heartbeatEvent(index));

  const body = (await loadRun(
    handlerWithLargeRecord(
      [
        ...stages.slice(0, 38),
        ...heartbeats.slice(0, 200),
        ...calibration,
        ...stages.slice(38, 41),
        ...reports,
        ...heartbeats.slice(200),
        stages[41],
      ],
      [],
    ),
  )) as unknown as RecordInternalsBody;

  expect(body.events.filter((event) => event.event_type === "stage")).toEqual(
    JSON.parse(JSON.stringify(stages)),
  );
  expect(body.events.filter((event) => event.event_type === "calibration")).toHaveLength(1_500);
});

test("calibration events past the size limit give way before stage changes", async () => {
  const stages = Array.from({ length: 30 }, (_, index) => stageChange(index));
  const calibration = Array.from({ length: 10_000 }, (_, index) =>
    calibrationEvent(index + 1, "x".repeat(300)),
  );

  const body = (await loadRun(
    handlerWithLargeRecord([...stages.slice(0, 15), ...calibration, ...stages.slice(15)], []),
  )) as unknown as RecordInternalsBody;

  expect(body.events.filter((event) => event.event_type === "stage")).toEqual(
    JSON.parse(JSON.stringify(stages)),
  );
  const keptCalibration = body.events.filter((event) => event.event_type === "calibration");
  expect(keptCalibration.length).toBeGreaterThan(0);
  expect(keptCalibration.length).toBeLessThan(10_000);
  // The newest calibration events are the ones kept, in the record's order.
  expect((keptCalibration.at(-1)?.details as { epoch: number }).epoch).toBe(10_000);
  // They fill what the stage changes leave of the limit.
  expect(JSON.stringify(body.events).length).toBeLessThanOrEqual(1_500_000);
  expect(JSON.stringify(body.events).length).toBeGreaterThan(1_490_000);
});

test("an unfinished run's internals from the collector's record keep the newest within a size limit", async () => {
  const padding = "x".repeat(2_000);
  const stageEvents = Array.from({ length: 6_000 }, (_, index) => ({
    event_type: "stage",
    stage: `stage-${index}`,
    status: "completed",
    time: new Date(Date.parse("2026-10-20T00:00:00Z") + index * 1_000).toISOString(),
    sequence: index + 1,
    details: { padding },
  }));
  const calibrationEvents = Array.from({ length: 6_000 }, (_, index) => ({ epoch: index, padding }));

  const body = (await loadRun(
    handlerWithLargeRecord(stageEvents, calibrationEvents),
  )) as unknown as RecordInternalsBody;

  expect(body.events.at(-1)?.sequence).toBe(6_000);
  expect(body.calibration_progress.events.at(-1)?.epoch).toBe(5_999);
  // Both lists together stay well within the platform's 4.5 MB response limit.
  expect(JSON.stringify(body.events).length).toBeLessThanOrEqual(1_500_000);
  expect(JSON.stringify(body.calibration_progress.events).length).toBeLessThanOrEqual(1_500_000);
});

test("a run whose copy records its end keeps the copy's stage events and calibration progress", async () => {
  const body = (await loadRun(handlerWithRecord("failed"))) as unknown as Record<string, unknown>;

  expect(body.run_internals_source).toBe("hugging_face");
  expect(body.events).toEqual([{ stage: "copied-event" }]);
  expect(body.calibration_progress).toEqual({ schema_version: 1, events: [{ epoch: 1, loss: 9 }] });
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
