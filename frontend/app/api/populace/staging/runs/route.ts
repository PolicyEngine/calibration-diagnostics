import { NextResponse } from "next/server";

import { loadStagingRuns } from "@/lib/populace/staging-artifact";
import { scrub } from "@/lib/populace/latest-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(scrub(await loadStagingRuns(revalidate)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
