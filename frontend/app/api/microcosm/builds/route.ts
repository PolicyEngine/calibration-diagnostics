import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import { parseBuildSource } from "@/lib/microcosm/build-source";
import { loadBuildRuns } from "@/lib/microcosm/build-runs";
import { scrub } from "@policyengine/calibration-tree/latest-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = requestedCountry(params);
  if (country instanceof Response) return country;
  const source = parseBuildSource(params.get("source"));
  try {
    return NextResponse.json(scrub(await loadBuildRuns(source, country)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
