import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import {
  type CollectorTimelines,
  loadCollectorTimelines,
} from "@/lib/microcosm/build-runs";
import {
  type CalibrationEpoch,
  candidateRunState,
  type HuggingFaceRunState,
} from "@/lib/microcosm/staging-run-state";
import {
  hasCapability,
  type MicrocosmCountry,
} from "@policyengine/calibration-tree/countries";
import { scrub } from "@policyengine/calibration-tree/latest-artifact";
import {
  loadStagingRun,
  type StagingRunDetail,
} from "@policyengine/calibration-tree/staging-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export interface StagingRunRouteDependencies {
  loadRun(
    runId: string,
    revalidate: number,
    country: MicrocosmCountry,
  ): Promise<StagingRunDetail>;
  loadCollectorTimelines(
    country: MicrocosmCountry,
    runIds: readonly string[],
    nowMs: number,
  ): Promise<CollectorTimelines>;
  now(): number;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function calibrationEpoch(value: unknown): CalibrationEpoch | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const calibration = value as Record<string, unknown>;
  return {
    epoch: finiteNumber(calibration.epoch),
    epochs: finiteNumber(calibration.epochs),
  };
}

// The state the run's Hugging Face copy records: its progress document, or
// its run manifest where the progress document says nothing.
function huggingFaceRunState(detail: StagingRunDetail): HuggingFaceRunState {
  const progress = detail.progress ?? {};
  const manifest = detail.run_manifest ?? {};
  return {
    status: text(progress.status) ?? text(manifest.status),
    stage: text(progress.stage) ?? text(manifest.stage),
    started_at: text(progress.started_at) ?? text(manifest.started_at),
    updated_at: text(progress.updated_at) ?? text(manifest.updated_at),
    calibration: calibrationEpoch(progress.calibration),
  };
}

// One Candidate tab run: its Hugging Face copy (candidate files, progress and
// events, unchanged) plus `state`, which is the collector's state when the
// collector has a record of the run.
export function createStagingRunHandler(
  dependencies: StagingRunRouteDependencies = {
    loadRun: loadStagingRun,
    loadCollectorTimelines,
    now: Date.now,
  },
) {
  return async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const country = requestedCountry(params);
    if (country instanceof Response) return country;
    const runId = params.get("id")?.trim();
    if (!runId && hasCapability(country, "staging")) {
      return NextResponse.json({ detail: "Provide a staging run id via ?id=." }, { status: 400 });
    }
    try {
      const detail = await dependencies.loadRun(runId ?? "", revalidate, country);
      if (!detail.available || !runId) {
        return NextResponse.json(scrub({ ...detail, state: null, collector_note: null }), {
          headers: { "Cache-Control": "no-store" },
        });
      }
      const nowMs = dependencies.now();
      const collector = await dependencies.loadCollectorTimelines(country, [runId], nowMs);
      return NextResponse.json(
        scrub({
          ...detail,
          state: candidateRunState(
            huggingFaceRunState(detail),
            collector.timelines.get(runId),
            nowMs,
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

export const GET = createStagingRunHandler();
