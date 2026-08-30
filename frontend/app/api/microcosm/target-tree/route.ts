import { NextResponse } from "next/server";

import {
  buildCalibrationTree,
  type CalibrationTreeTarget,
} from "@/lib/microcosm/calibration-tree";
import { calibrationTreeRequestState } from "@/lib/microcosm/calibration-tree-request";
import {
  classifyApiError,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    const calibration = await loadRelease(release, revalidate, country);
    const state = calibrationTreeRequestState(params);
    return NextResponse.json(
      scrub(
        buildCalibrationTree(
          calibration.rows as CalibrationTreeTarget[],
          state,
          calibration.release_id,
          calibration.target_loss_attribution.status !== "unavailable",
        ),
      ),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
