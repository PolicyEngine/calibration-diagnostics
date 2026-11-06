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
import type { ViewerZone } from "@/lib/microcosm/viewer-time";
import { CandidateOverview, HuggingFaceCopyNote, runLabel } from "./microcosm-staging-view";

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
      zone: null,
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

const NEW_YORK: ViewerZone = { timeZone: "America/New_York", locale: "en-US" };

// Some versions of the Unicode locale data put a narrow no-break space
// before "AM" and "PM".
function plain(text: string): string {
  return text.replace(/\u202f/g, " ");
}

test("the candidate's picker label and overview times read in the viewer's zone, named, with UTC on hover", () => {
  const state = candidateRunState(
    FAILED_RUN_PROGRESS,
    buildTimeline(usFailedCollectorDocuments(), INVESTIGATION_NOW_MS),
    INVESTIGATION_NOW_MS,
  );

  expect(
    plain(runLabel({ run_id: US_FAILED_RUN_ID, candidate_release_id: US_FAILED_RUN_ID, ...state }, NEW_YORK)),
  ).toBe("Oct 19, 06:23 PM · b5db38");

  const markup = plain(
    renderToStaticMarkup(
      createElement(CandidateOverview, {
        candidateReleaseId: US_FAILED_RUN_ID,
        state,
        progress: FAILED_RUN_PROGRESS,
        calibration: null,
        collectorNote: null,
        zone: NEW_YORK,
      }),
    ),
  );
  // The collector's last update, 06:37:45 UTC on October 20, on the second
  // line of the row's hover text.
  expect(markup).toContain('\nTue, Oct 20, 2026, 02:37:45 AM EDT · 2026-10-20 06:37:45 UTC"');
  expect(markup).toContain(">Oct 20, 02:37 AM EDT · ");
  // The Hugging Face copy's last upload, 06:09:35 UTC.
  expect(markup).toContain("epoch 273 of 1500 · updated Oct 20, 02:09 AM EDT · ");
});

test("the Hugging Face copy's update time has UTC on hover, in the overview and the Run internals note", () => {
  const state = candidateRunState(
    FAILED_RUN_PROGRESS,
    buildTimeline(usFailedCollectorDocuments(), INVESTIGATION_NOW_MS),
    INVESTIGATION_NOW_MS,
  );
  // The copy's last upload, 06:09:35 UTC on October 20.
  const hoverText = 'title="Tue, Oct 20, 2026, 02:09:35 AM EDT · 2026-10-20 06:09:35 UTC"';

  const overview = plain(
    renderToStaticMarkup(
      createElement(CandidateOverview, {
        candidateReleaseId: US_FAILED_RUN_ID,
        state,
        progress: FAILED_RUN_PROGRESS,
        calibration: null,
        collectorNote: null,
        zone: NEW_YORK,
      }),
    ),
  );
  // On the second line of the row's hover text, below the row's own text.
  expect(overview).toContain('\nTue, Oct 20, 2026, 02:09:35 AM EDT · 2026-10-20 06:09:35 UTC"');

  const note = plain(
    renderToStaticMarkup(
      createElement(HuggingFaceCopyNote, { state, progress: FAILED_RUN_PROGRESS, zone: NEW_YORK }),
    ),
  );
  expect(note).toContain("These sections read the run&#x27;s Hugging Face copy (");
  expect(note).toContain("updated Oct 20, 02:09 AM EDT · ");
  expect(note).toContain(hoverText);
});

// The hover text of each overview row whose value contains `valueText`.
function rowHoverTexts(markup: string, valueText: string): string[] {
  return [...markup.matchAll(/title="([^"]*)"/g)]
    .map((match) => match[1].replace(/&#x27;/g, "'"))
    .filter((title) => title.includes(valueText));
}

test("an overview time row keeps its full text on hover, above the time in full and in UTC", () => {
  const state = candidateRunState(
    FAILED_RUN_PROGRESS,
    buildTimeline(usFailedCollectorDocuments(), INVESTIGATION_NOW_MS),
    INVESTIGATION_NOW_MS,
  );
  const baku: ViewerZone = { timeZone: "Asia/Baku", locale: "en-US" };

  for (const [zone, copyUpdated, copyHover] of [
    [NEW_YORK, "updated Oct 20, 02:09 AM EDT", "Tue, Oct 20, 2026, 02:09:35 AM EDT · 2026-10-20 06:09:35 UTC"],
    [baku, "updated Oct 20, 10:09 AM GMT+4", "Tue, Oct 20, 2026, 10:09:35 AM GMT+4 · 2026-10-20 06:09:35 UTC"],
  ] as const) {
    const markup = plain(
      renderToStaticMarkup(
        createElement(CandidateOverview, {
          candidateReleaseId: US_FAILED_RUN_ID,
          state,
          progress: FAILED_RUN_PROGRESS,
          calibration: null,
          collectorNote: null,
          zone,
        }),
      ),
    );
    // The Hugging Face copy row: what the copy records, then the time.
    const [copyTitle] = rowHoverTexts(markup, "epoch 273 of 1500");
    expect(copyTitle).toStartWith(`Running, Calibration, epoch 273 of 1500 · ${copyUpdated} · `);
    expect(copyTitle).toEndWith(`\n${copyHover}`);
    // The last update row keeps its "· 17d ago" part.
    const [updateTitle] = rowHoverTexts(markup, "06:37:45 UTC");
    expect(updateTitle).toMatch(/ · \d+d ago\n/);
    // The last heartbeat row has the heartbeat's own time, 06:37:43 UTC.
    const [heartbeatTitle] = rowHoverTexts(markup, "06:37:43 UTC");
    expect(heartbeatTitle).toMatch(/ · \d+d ago\n.*2026-10-20 06:37:43 UTC$/);
  }
});
