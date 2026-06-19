import { NextResponse } from "next/server";

import {
  loadRelease,
  populaceTargetTreemap,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const release = new URL(request.url).searchParams.get("release") ?? "latest";
  try {
    const cal = await loadRelease(release, revalidate);
    return NextResponse.json(
      scrub(populaceTargetTreemap(cal.rows, cal.release_id)),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
