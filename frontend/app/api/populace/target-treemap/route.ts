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
  const level = params.get("level") || null;
  try {
    const cal = await loadRelease(release, revalidate, country);
    return NextResponse.json(
      scrub(populaceTargetTreemap(cal.rows, cal.release_id, level)),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
