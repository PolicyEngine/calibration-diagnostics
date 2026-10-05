import { NextResponse } from "next/server";

import { loadBuildRuns } from "@/lib/microcosm/build-runs";
import { parseCountry, scrub } from "@/lib/microcosm/latest-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = parseCountry(params.get("country"));
  try {
    return NextResponse.json(scrub(await loadBuildRuns(country)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
