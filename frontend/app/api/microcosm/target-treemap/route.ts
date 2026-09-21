import { NextResponse } from "next/server";

import {
  classifyApiError,
  parseCountry,
  microcosmTargetTreemap,
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
  const rawBreakdown = params.get("breakdown");
  const breakdown = rawBreakdown === "geography" ? "geography" : "program";
  try {
    // A staging candidate (`staging:<run_id>`) is reviewed like a release; its
    // diagnostics can still change, so it is never cached.
    const staged = isStagingSelection(release);
    const cal = await loadSelectedCalibration(release, staged ? 0 : revalidate, country);
    return NextResponse.json(
      scrub(
        microcosmTargetTreemap(
          cal.rows,
          cal.release_id,
          breakdown,
          cal.target_loss_attribution.status !== "unavailable",
        ),
      ),
      staged ? { headers: { "Cache-Control": "no-store" } } : undefined,
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
