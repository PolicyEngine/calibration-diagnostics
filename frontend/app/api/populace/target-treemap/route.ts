import { NextResponse } from "next/server";

import {
  classifyApiError,
  loadRelease,
  parseCountry,
  populaceTargetTreemap,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  const rawBreakdown = params.get("breakdown");
  const breakdown = rawBreakdown === "geography" ? "geography" : "program";
  try {
    const cal = await loadRelease(release, revalidate, country);
    return NextResponse.json(
      scrub(populaceTargetTreemap(cal.rows, cal.release_id, breakdown)),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
