import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import {
  classifyApiError,
  loadRelease,
  microcosmTargetTreemap,
  scrub,
} from "@policyengine/calibration-tree/latest-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = requestedCountry(params);
  if (country instanceof Response) return country;
  const rawBreakdown = params.get("breakdown");
  const breakdown = rawBreakdown === "geography" ? "geography" : "program";
  try {
    const cal = await loadRelease(release, revalidate, country);
    return NextResponse.json(
      scrub(
        microcosmTargetTreemap(
          cal.rows,
          cal.release_id,
          breakdown,
          cal.target_loss_attribution.status !== "unavailable",
        ),
      ),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
