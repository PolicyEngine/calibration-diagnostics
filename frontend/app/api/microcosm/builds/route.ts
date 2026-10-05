import { NextResponse } from "next/server";

import { parseBuildSource } from "@/lib/microcosm/build-source";
import { loadBuildRuns } from "@/lib/microcosm/build-runs";
import { parseCountry, scrub } from "@/lib/microcosm/latest-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = parseCountry(params.get("country"));
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
