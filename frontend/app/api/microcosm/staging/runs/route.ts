import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import { loadStagingRuns } from "@policyengine/calibration-tree/staging-artifact";
import { scrub } from "@policyengine/calibration-tree/latest-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const country = requestedCountry(new URL(request.url).searchParams);
  if (country instanceof Response) return country;
  try {
    return NextResponse.json(scrub(await loadStagingRuns(revalidate, country)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
