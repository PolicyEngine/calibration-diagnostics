import { NextResponse } from "next/server";

import {
  latestPopulaceTargetDiagnosticsPage,
  loadRelease,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  const release = new URL(request.url).searchParams.get("release") ?? "latest";
  try {
    const cal = await loadRelease(release, revalidate);
    return NextResponse.json(scrub(latestPopulaceTargetDiagnosticsPage(request.url, cal)));
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
