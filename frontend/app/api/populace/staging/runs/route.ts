import { NextResponse } from "next/server";

import { loadStagingRuns } from "@/lib/populace/staging-artifact";
import { scrub } from "@/lib/populace/latest-artifact";

export const revalidate = 30;

export async function GET() {
  try {
    return NextResponse.json(scrub(await loadStagingRuns(revalidate)));
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
