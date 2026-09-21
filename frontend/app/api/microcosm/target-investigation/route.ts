import { NextResponse } from "next/server";

import {
  classifyApiError,
  latestMicrocosmTargetInvestigation,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";
import { isStagingSelection } from "@/lib/microcosm/calibration-selection";
import { loadSelectedCalibration } from "@/lib/microcosm/staging-artifact";

export const revalidate = 21_600;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const release = searchParams.get("release") || "latest";
    const country = parseCountry(searchParams.get("country"));
    // A staging candidate (`staging:<run_id>`) is reviewed like a release; its
    // diagnostics can still change, so it is never cached.
    const staged = isStagingSelection(release);
    const cal = await loadSelectedCalibration(release, staged ? 0 : revalidate, country);
    return NextResponse.json(
      scrub(latestMicrocosmTargetInvestigation(request.url, cal)),
      staged ? { headers: { "Cache-Control": "no-store" } } : undefined,
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    if (status === 400) return NextResponse.json(body, { status });
    return NextResponse.json({ available: false, ...body }, { status });
  }
}
