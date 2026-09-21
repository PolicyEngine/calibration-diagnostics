import { NextResponse } from "next/server";

import {
  buildCalibrationTree,
  type CalibrationTreeTarget,
} from "@/lib/microcosm/calibration-tree";
import { calibrationTreeRequestState } from "@/lib/microcosm/calibration-tree-request";
import {
  classifyApiError,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";
import { isStagingSelection } from "@/lib/microcosm/calibration-selection";
import { loadSelectedCalibration } from "@/lib/microcosm/staging-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    // A staging candidate (`staging:<run_id>`) is reviewed like a release; its
    // diagnostics can still change, so it is never cached.
    const staged = isStagingSelection(release);
    const calibration = await loadSelectedCalibration(release, staged ? 0 : revalidate, country);
    const state = calibrationTreeRequestState(params);
    return NextResponse.json(
      scrub(
        buildCalibrationTree(
          calibration.rows as CalibrationTreeTarget[],
          state,
          calibration.release_id,
          calibration.target_loss_attribution.status !== "unavailable",
          calibration.calibration_provenance,
        ),
      ),
      staged ? { headers: { "Cache-Control": "no-store" } } : undefined,
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
