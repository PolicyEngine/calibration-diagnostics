import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  type BuildForecast,
  type BuildTimeline,
  buildTimeline,
  phaseTotals,
} from "@/lib/microcosm/build-monitor";
import {
  INVESTIGATION_NOW_MS,
  usFailedCollectorDocuments,
  usRunningCollectorDocuments,
} from "@/lib/microcosm/test-support/collector-run-fixtures";
import type { ViewerZone } from "@/lib/microcosm/viewer-time";
import { linkedRunOptionLabel, RunHistoryItem, RunOverview, runOptionLabel } from "./build-monitor-view";
import { useViewerZone } from "./viewer-time";

const LONDON: ViewerZone = { timeZone: "Europe/London", locale: "en-GB" };
const NEW_YORK: ViewerZone = { timeZone: "America/New_York", locale: "en-US" };

// Some versions of the Unicode locale data put a narrow no-break space
// before "AM" and "PM".
function plain(text: string): string {
  return text.replace(/ /g, " ");
}

// The failed US run started at 22:23:36 UTC on Monday, October 19, and
// ended at 06:37:45 UTC the next day.
function failedRun(): BuildTimeline {
  return buildTimeline(usFailedCollectorDocuments(), INVESTIGATION_NOW_MS);
}

function forecastFinishing(finishP50: string, finishP90: string): BuildForecast {
  return {
    basis_runs: [],
    finished_runs: 1,
    method: "run_total",
    pace: null,
    elapsed_ms: 0,
    remaining_p50_ms: null,
    remaining_p90_ms: null,
    finish_p50_ms: Date.parse(finishP50),
    finish_p90_ms: Date.parse(finishP90),
    fraction_complete: null,
    current_stage: null,
    current_stage_elapsed_ms: null,
    current_stage_typical_ms: null,
    current_stage_p90_ms: null,
    overrunning: false,
    calibration: null,
    solver: null,
    stage_work: null,
    stages: [],
    note: null,
  };
}

function overview(
  run: BuildTimeline,
  forecast: BuildForecast | null,
  zone: ViewerZone,
): string {
  return plain(
    renderToStaticMarkup(
      createElement(RunOverview, { run, forecast, nowMs: INVESTIGATION_NOW_MS, zone }),
    ),
  );
}

test("the run overview names the viewer's zone on the run's start and end, with no UTC hover text", () => {
  // In October London keeps summer time (BST, UTC+1).
  const markup = overview(failedRun(), null, LONDON);

  expect(markup).toContain('Started <time dateTime="2026-10-19T22:23:36.000Z">19 Oct, 23:23 BST</time>');
  expect(markup).toContain('<time dateTime="2026-10-20T06:37:45.000Z">20 Oct, 07:37 BST</time>');
  expect(markup).not.toContain("UTC");
});

test("a running run's expected finish reads in the viewer's zone, named", () => {
  const running = buildTimeline(usRunningCollectorDocuments(), INVESTIGATION_NOW_MS);
  const forecast = forecastFinishing("2026-10-23T01:30:00Z", "2026-10-23T04:45:00Z");

  const markup = overview(running, forecast, NEW_YORK);

  expect(markup).toContain(">Oct 21, 12:02 PM EDT</time>");
  // 01:30 UTC on October 23 is still October 22 in New York, the viewer's
  // today, so the date is left out.
  expect(markup).toContain('<time dateTime="2026-10-23T01:30:00.000Z">09:30 PM EDT</time>');
  expect(markup).toContain("90% by <time");
  expect(markup).toContain(">Oct 23, 12:45 AM EDT</time>");
});

test("the run selector and run history give each run's start in the viewer's zone, named", () => {
  const run = failedRun();

  expect(plain(runOptionLabel(run, INVESTIGATION_NOW_MS, NEW_YORK))).toStartWith(
    "Failed · Oct 19, 6:23 PM EDT · ",
  );

  const markup = plain(
    renderToStaticMarkup(
      createElement(RunHistoryItem, {
        run,
        total: phaseTotals(run, INVESTIGATION_NOW_MS),
        longest: 1,
        selected: false,
        onSelect: () => {},
        zone: NEW_YORK,
      }),
    ),
  );
  expect(markup).toContain('<time dateTime="2026-10-19T22:23:36.000Z">Mon, Oct 19, 6:23 PM EDT</time>');
});

test("a linked run the list does not hold is named in the Run selector only once its detail arrives", () => {
  const run = failedRun();

  // Never the ID from the URL, which may name no run at all.
  expect(linkedRunOptionLabel("not-a-run", undefined, INVESTIGATION_NOW_MS, NEW_YORK)).toBe("Loading run…");
  expect(linkedRunOptionLabel(run.run_id, undefined, INVESTIGATION_NOW_MS, NEW_YORK)).toBe("Loading run…");
  expect(linkedRunOptionLabel(run.run_id, run, INVESTIGATION_NOW_MS, NEW_YORK)).toBe(
    runOptionLabel(run, INVESTIGATION_NOW_MS, NEW_YORK),
  );
});

function ZoneProbe() {
  return createElement("span", null, useViewerZone()?.timeZone ?? "no zone");
}

// The server cannot know the browser's zone, so it formats no time in one.
test("the zone is unknown during the server's render", () => {
  expect(renderToStaticMarkup(createElement(ZoneProbe))).toBe("<span>no zone</span>");
});

test("a run silent for more than a day says when its last telemetry came, in the viewer's zone", () => {
  // The running US run's last telemetry came at 17:16:47 UTC on October 22.
  const nowMs = Date.parse("2026-10-24T18:00:00Z");
  const stalled = buildTimeline(usRunningCollectorDocuments(), nowMs);

  const markup = plain(
    renderToStaticMarkup(createElement(RunOverview, { run: stalled, forecast: null, nowMs, zone: NEW_YORK })),
  );

  expect(markup).toContain(
    'The last telemetry came 25 h 14 min after the run started, on <time dateTime="2026-10-22T17:16:47.000Z">Oct 22, 01:16 PM EDT</time>, and the run wrote no final event. The telemetry does not say why it stopped, or whether the process is still working without reporting.',
  );
});
