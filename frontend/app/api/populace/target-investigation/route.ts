import { NextResponse } from "next/server";

import {
  latestPopulaceTargetInvestigation,
  loadRelease,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const release = searchParams.get("release") || "latest";
    const cal = await loadRelease(release, revalidate);
    return NextResponse.json(scrub(latestPopulaceTargetInvestigation(request.url, cal)));
  } catch (error) {
    return NextResponse.json(
      { available: false, detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
