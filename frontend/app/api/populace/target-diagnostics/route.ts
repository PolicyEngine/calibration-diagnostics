import { NextResponse } from "next/server";

import {
  latestPopulaceTargetDiagnosticsPage,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    const cal = await loadRelease(release, revalidate, country);
    return NextResponse.json(scrub(latestPopulaceTargetDiagnosticsPage(request.url, cal)));
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
