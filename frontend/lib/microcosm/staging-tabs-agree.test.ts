// One run seen through both Staging tabs, when the collector and the Hugging
// Face copy record different states. The Candidate tab overlays the collector's
// state on the Hugging Face summary; Build progress merges the two sources'
// documents for its list and refreshes the selected run from the collector.
// Both must apply the same rule to choose between them.
import { describe, expect, test } from "bun:test";

import {
  type BuildRunDocuments,
  type BuildRunState,
  buildTimeline,
} from "@/lib/microcosm/build-monitor";
import {
  type HostedRunLoaders,
  mergeHostedDocuments,
  refreshHostedRun,
} from "@/lib/microcosm/build-runs";
import { overlayRunSummary } from "@/lib/microcosm/staging-run-state";
import {
  INVESTIGATION_NOW_MS,
  UK_BLOCKED_RUN_ID,
  US_RUNNING_RUN_ID,
  huggingFaceSummary,
  ukBlockedCollectorDocuments,
  usRunningCollectorDocuments,
} from "@/lib/microcosm/test-support/collector-run-fixtures";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";

interface HuggingFaceEnd {
  schemaVersion: 1 | 3;
  status: string;
  stage: string;
  updatedAt: string;
}

// The run's Hugging Face copy as Build progress reads it: its progress
// document and events, the last event recording `end`.
function huggingFaceDocuments(
  runId: string,
  country: MicrocosmCountry,
  end: HuggingFaceEnd,
): BuildRunDocuments {
  const startedAt = "2026-10-18T16:10:08+00:00";
  return {
    run_id: runId,
    source: "staging",
    country,
    progress: {
      schema_version: end.schemaVersion,
      run_id: runId,
      status: end.status,
      stage: end.stage,
      started_at: startedAt,
      updated_at: end.updatedAt,
    },
    run_manifest: null,
    calibration_progress: null,
    events: [
      { time: startedAt, type: "stage", status: "running", stage: "created" },
      { time: end.updatedAt, type: "stage", status: end.status, stage: end.stage },
    ],
  };
}

// The same copy as the Candidate tab lists it.
function huggingFaceListing(runId: string, end: HuggingFaceEnd) {
  return huggingFaceSummary(runId, {
    schema_version: end.schemaVersion,
    status: end.status,
    stage: end.stage,
    started_at: "2026-10-18T16:10:08+00:00",
    updated_at: end.updatedAt,
  });
}

async function buildProgressStates(
  collector: BuildRunDocuments,
  huggingFace: BuildRunDocuments,
  nowMs: number,
): Promise<{ listed: BuildRunState | undefined; selected: BuildRunState | undefined }> {
  const listed = mergeHostedDocuments([collector], [huggingFace], nowMs)
    .map((documents) => buildTimeline(documents, nowMs))
    .find((timeline) => timeline.run_id === collector.run_id);
  const loaders: HostedRunLoaders = {
    collectorConfigured: () => true,
    hasStagingHistory: () => true,
    loadCollector: async () => collector,
    loadHistory: async () => huggingFace,
  };
  const selected = await refreshHostedRun(
    listed ?? null,
    collector.country as MicrocosmCountry,
    collector.run_id,
    nowMs,
    loaders,
  );
  return { listed: listed?.state, selected: selected?.state };
}

describe("both Staging tabs show the same state for a run both sources know", () => {
  test("a collector record that stopped before the run ended gives way to a later Hugging Face end", async () => {
    // The collector last heard from the run at 17:16:47, so by 20:10 its record
    // says stalled; the Hugging Face copy recorded the run passing at 20:05.
    const laterNowMs = Date.parse("2026-10-22T20:10:00Z");
    const end: HuggingFaceEnd = {
      schemaVersion: 1,
      status: "passed",
      stage: "complete",
      updatedAt: "2026-10-22T20:05:00+00:00",
    };
    const collector = usRunningCollectorDocuments();

    const candidate = overlayRunSummary(
      huggingFaceListing(US_RUNNING_RUN_ID, end),
      buildTimeline(collector, laterNowMs),
      laterNowMs,
    );
    const buildProgress = await buildProgressStates(
      collector,
      huggingFaceDocuments(US_RUNNING_RUN_ID, "us", end),
      laterNowMs,
    );

    expect(buildTimeline(collector, laterNowMs).state).toBe("stalled");
    expect(candidate.status).toBe("passed");
    expect(buildProgress).toEqual({ listed: "passed", selected: "passed" });
  });

  test("a final collector state stands even when the Hugging Face copy recorded the end later", async () => {
    // The collector infers the refusal from its acceptance check events; the
    // copy closed the run as completed a little later.
    const end: HuggingFaceEnd = {
      schemaVersion: 3,
      status: "completed",
      stage: "complete",
      updatedAt: "2026-10-18T23:46:30+00:00",
    };
    const collector = ukBlockedCollectorDocuments();

    const candidate = overlayRunSummary(
      huggingFaceListing(UK_BLOCKED_RUN_ID, end),
      buildTimeline(collector, INVESTIGATION_NOW_MS),
      INVESTIGATION_NOW_MS,
    );
    const buildProgress = await buildProgressStates(
      collector,
      huggingFaceDocuments(UK_BLOCKED_RUN_ID, "uk", end),
      INVESTIGATION_NOW_MS,
    );

    expect(candidate.status).toBe("blocked");
    expect(buildProgress).toEqual({ listed: "blocked", selected: "blocked" });
  });

  test("a collector record newer than a Hugging Face end stands", async () => {
    // The copy recorded a failure before the collector's last heartbeat, so
    // the collector's later record of a running run wins on both tabs.
    const end: HuggingFaceEnd = {
      schemaVersion: 1,
      status: "failed",
      stage: "failed",
      updatedAt: "2026-10-22T17:00:00+00:00",
    };
    const collector = usRunningCollectorDocuments();

    const candidate = overlayRunSummary(
      huggingFaceListing(US_RUNNING_RUN_ID, end),
      buildTimeline(collector, INVESTIGATION_NOW_MS),
      INVESTIGATION_NOW_MS,
    );
    const buildProgress = await buildProgressStates(
      collector,
      huggingFaceDocuments(US_RUNNING_RUN_ID, "us", end),
      INVESTIGATION_NOW_MS,
    );

    expect(candidate.status).toBe("running");
    expect(buildProgress).toEqual({ listed: "running", selected: "running" });
  });
});
