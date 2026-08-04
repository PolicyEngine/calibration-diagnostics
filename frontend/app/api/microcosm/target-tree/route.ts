import { NextResponse } from "next/server";

import { parseExplorerSearch } from "@/lib/microcosm/calibration-explorer";
import {
  buildCalibrationTree,
  type CalibrationTreeTarget,
} from "@/lib/microcosm/calibration-tree";
import {
  classifyApiError,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    const calibration = await loadRelease(release, revalidate, country);
    const state = parseExplorerSearch(params);
    return NextResponse.json(
      scrub(
        buildCalibrationTree(
          calibration.rows as CalibrationTreeTarget[],
          state,
          calibration.release_id,
        ),
      ),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
