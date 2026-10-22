import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildTimeline } from "@/lib/microcosm/build-monitor";
import {
  candidateRunState,
  type CandidateRunState,
} from "@/lib/microcosm/staging-run-state";
import {
  INVESTIGATION_NOW_MS,
  UK_BLOCKED_RUN_ID,
  US_FAILED_RUN_ID,
  US_RUNNING_RUN_ID,
  ukBlockedCollectorDocuments,
  usFailedCollectorDocuments,
  usRunningCollectorDocuments,
} from "@/lib/microcosm/test-support/collector-run-fixtures";
import { CandidateOverview } from "./microcosm-staging-view";

// The failed US run's Hugging Face progress document: its last upload.
const FAILED_RUN_PROGRESS = {
  status: "running",
  stage: "calibrating",
  started_at: "2026-10-19T22:25:40+00:00",
  updated_at: "2026-10-20T06:09:35+00:00",
  calibration: { epoch: 273, epochs: 1500 },
};

function renderOverview(
  runId: string,
  state: CandidateRunState,
  progress: Record<string, unknown>,
  collectorNote: string | null = null,
): string {
  return renderToStaticMarkup(
    createElement(CandidateOverview, {
      candidateReleaseId: runId,
      state,
      progress,
      calibration: null,
      collectorNote,
    }),
  );
}

test("the failed US run shows the collector's failure and its out-of-date Hugging Face copy", () => {
  const state = candidateRunState(
    FAILED_RUN_PROGRESS,
    buildTimeline(usFailedCollectorDocuments(), INVESTIGATION_NOW_MS),
    INVESTIGATION_NOW_MS,
  );

  const markup = renderOverview(US_FAILED_RUN_ID, state, FAILED_RUN_PROGRESS);

  expect(markup).toContain(">Failed<");
  expect(markup).toContain("Telemetry collector");
  expect(markup).toContain("Failed during Release gates");
  expect(markup).toContain("relative_error=-0.0641635");
  expect(markup).toContain("Hugging Face copy");
  expect(markup).toContain("Running, Calibration, epoch 273 of 1500 · updated");
  expect(markup).not.toContain("Stalled");
});

test("the US run in reform validation shows that stage and its last heartbeat", () => {
  const progress = {
    status: "running",
    stage: "calibrating",
    updated_at: "2026-10-21T18:59:03+00:00",
    calibration: { epoch: 935, epochs: 1500 },
  };
  const state = candidateRunState(
    { ...progress, started_at: null },
    buildTimeline(usRunningCollectorDocuments(), INVESTIGATION_NOW_MS),
    INVESTIGATION_NOW_MS,
  );

  const markup = renderOverview(US_RUNNING_RUN_ID, state, progress);

  expect(markup).toContain(">Running<");
  expect(markup).toContain("Reform validation");
  expect(markup).toContain("Last heartbeat");
  expect(markup).toContain("Running, Calibration, epoch 935 of 1500 · updated");
});

test("a collector failure shows the Hugging Face state and the collector note", () => {
  const note =
    "The telemetry collector could not be read (Telemetry collector request failed (503).), so run states come from the Hugging Face staging repository.";
  const state = candidateRunState(FAILED_RUN_PROGRESS, undefined, INVESTIGATION_NOW_MS);

  const markup = renderOverview(US_FAILED_RUN_ID, state, FAILED_RUN_PROGRESS, note);

  expect(markup).toContain(">Stalled<");
  expect(markup).toContain("Hugging Face staging repository");
  expect(markup).toContain("Calibration, epoch 273 of 1500");
  expect(markup).toContain("Telemetry collector request failed (503).");
  expect(markup).not.toContain("Hugging Face copy");
  expect(markup).not.toContain("Last heartbeat");
});

test("a UK run refused by its acceptance checks shows where, without a copy warning", () => {
  const progress = {
    status: "blocked",
    stage: "blocked",
    updated_at: "2026-10-18T23:45:45+00:00",
  };
  const state = candidateRunState(
    { ...progress, started_at: null },
    buildTimeline(ukBlockedCollectorDocuments(), INVESTIGATION_NOW_MS),
    INVESTIGATION_NOW_MS,
  );

  const markup = renderOverview(UK_BLOCKED_RUN_ID, state, progress);

  expect(markup).toContain(">Blocked<");
  expect(markup).toContain("Refused at Gate battery");
  expect(markup).toContain("Telemetry collector");
  expect(markup).not.toContain("Hugging Face copy");
});
