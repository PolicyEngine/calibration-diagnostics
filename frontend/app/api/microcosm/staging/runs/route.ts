import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import {
  type CollectorTimelineOptions,
  type CollectorTimelines,
  loadCollectorTimelines,
} from "@/lib/microcosm/build-runs";
import {
  huggingFaceRecordsAnEnd,
  overlayRunSummary,
} from "@/lib/microcosm/staging-run-state";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import { scrub } from "@policyengine/calibration-tree/latest-artifact";
import type {
  IncompatibleStagingRun,
  StagingRunSummary,
} from "@policyengine/calibration-tree/staging-artifact";
import { loadStoredStagingRuns } from "@/lib/microcosm/stored-staging";

// The run list `loadStoredStagingRuns` gives, as `loadStagingRuns` gave it.
export interface StagingRunList {
  available: boolean;
  source_repo: string | null;
  revision: string | null;
  detail?: string | null;
  truncated: boolean;
  runs: StagingRunSummary[];
  incompatible_runs: IncompatibleStagingRun[];
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
// The collector lookup waits at most 5 seconds for the shared run list, but a
// run's own record can still take its 30-second request timeout.
export const maxDuration = 120;

export interface StagingRunsRouteDependencies {
  loadRuns(
    revalidate: number,
    country: MicrocosmCountry,
  ): Promise<StagingRunList>;
  loadCollectorTimelines(
    country: MicrocosmCountry,
    runIds: readonly string[],
    nowMs: number,
    options: CollectorTimelineOptions,
  ): Promise<CollectorTimelines>;
  now(): number;
}

// The Candidate tab's run list: the runs in the country's Hugging Face staging
// repository, from the collector's copies of their files, each with the
// collector's state when the collector has a record of it. Runs only the
// collector knows have no candidate files there and are listed on the Build
// progress tab instead.
export function createStagingRunsHandler(
  dependencies: StagingRunsRouteDependencies = {
    loadRuns: loadStoredStagingRuns,
    loadCollectorTimelines,
    now: Date.now,
  },
) {
  return async function GET(request: Request) {
    const country = requestedCountry(new URL(request.url).searchParams);
    if (country instanceof Response) return country;
    try {
      const list = await dependencies.loadRuns(revalidate, country);
      const nowMs = dependencies.now();
      const collector: CollectorTimelines = list.runs.length
        ? await dependencies.loadCollectorTimelines(
            country,
            list.runs.map((run) => run.run_id),
            nowMs,
            {
              unfinishedRunIds: list.runs
                .filter((run) => !huggingFaceRecordsAnEnd(run.status))
                .map((run) => run.run_id),
            },
          )
        : { timelines: new Map(), note: null };
      return NextResponse.json(
        scrub({
          ...list,
          runs: list.runs.map((run) =>
            overlayRunSummary(run, collector.timelines.get(run.run_id), nowMs),
          ),
          collector_note: collector.note,
        }),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return NextResponse.json(
        { detail: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  };
}

export const GET = createStagingRunsHandler();
