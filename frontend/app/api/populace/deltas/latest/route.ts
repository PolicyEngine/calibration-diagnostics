import { NextResponse } from "next/server";

import { classifyApiError, parseCountry, scrub } from "@/lib/populace/latest-artifact";
import { loadLatestDelta, loadReleaseDelta } from "@/lib/populace/deltas";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 120;

// The release-delta feed: the same payload the Slack alert posts and the
// "since you last looked" banner reads. Defaults to latest vs previous; ?a=&b=
// diffs an arbitrary pair.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const a = params.get("a");
  const b = params.get("b");
  const country = parseCountry(params.get("country"));
  try {
    const report =
      a && b
        ? await loadReleaseDelta(a, b, revalidate, country)
        : await loadLatestDelta(revalidate, country);
    return NextResponse.json(scrub(report));
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
