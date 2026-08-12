import { NextResponse } from "next/server";

import {
  classifyApiError,
  latestMicrocosmTargetDiagnosticsPage,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";
import { loadStagingTargetDiagnostics } from "@/lib/microcosm/staging-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    // A candidate staging run reviewed with the same page as a release.
    if (release.startsWith("staging:")) {
      return NextResponse.json(
        scrub(
          await loadStagingTargetDiagnostics(request.url, release.slice("staging:".length), 0),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const cal = await loadRelease(release, revalidate, country);
    return NextResponse.json(scrub(latestMicrocosmTargetDiagnosticsPage(request.url, cal)));
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
