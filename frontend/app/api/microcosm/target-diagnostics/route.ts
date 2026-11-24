import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import {
  classifyApiError,
  latestMicrocosmTargetDiagnosticsPage,
  scrub,
} from "@policyengine/calibration-tree/latest-artifact";
import { loadStoredRelease } from "@/lib/microcosm/collector-store";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = requestedCountry(params);
  if (country instanceof Response) return country;
  try {
    const cal = await loadStoredRelease(release, revalidate, country);
    return NextResponse.json(scrub(latestMicrocosmTargetDiagnosticsPage(request.url, cal)));
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
