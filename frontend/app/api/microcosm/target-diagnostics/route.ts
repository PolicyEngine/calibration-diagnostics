import { NextResponse } from "next/server";

import {
  classifyApiError,
  latestMicrocosmTargetDiagnosticsPage,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";
import { stagingRunIdOf } from "@/lib/microcosm/calibration-selection";
import { loadStagingTargetDiagnostics } from "@/lib/microcosm/staging-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    // A candidate staging run reviewed with the same page as a release.
    const stagingRunId = stagingRunIdOf(release);
    if (stagingRunId != null) {
      return NextResponse.json(
        scrub(await loadStagingTargetDiagnostics(request.url, stagingRunId, 0, country)),
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
