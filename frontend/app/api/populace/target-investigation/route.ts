import { NextResponse } from "next/server";

import {
  InvalidReleaseIdError,
  latestPopulaceTargetInvestigation,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const release = searchParams.get("release") || "latest";
    const country = parseCountry(searchParams.get("country"));
    const cal = await loadRelease(release, revalidate, country);
    return NextResponse.json(scrub(latestPopulaceTargetInvestigation(request.url, cal)));
  } catch (error) {
    if (error instanceof InvalidReleaseIdError) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { available: false, detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
