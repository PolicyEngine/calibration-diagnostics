import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import {
  classifyApiError,
  latestMicrocosmTargetInvestigation,
  loadRelease,
  scrub,
} from "@policyengine/calibration-tree/latest-artifact";

export const revalidate = 21_600;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const release = searchParams.get("release") || "latest";
    const country = requestedCountry(searchParams);
    if (country instanceof Response) return country;
    const cal = await loadRelease(release, revalidate, country);
    return NextResponse.json(
      scrub(latestMicrocosmTargetInvestigation(request.url, cal)),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    if (status === 400) return NextResponse.json(body, { status });
    return NextResponse.json({ available: false, ...body }, { status });
  }
}
