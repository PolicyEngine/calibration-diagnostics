import { NextResponse } from "next/server";

import {
  classifyApiError,
  loadPointerReleaseId,
  parseCountry,
  scrub,
} from "@/lib/populace/latest-artifact";
import {
  loadInputColumnCoverage,
  loadReformSmoke,
  loadSourceCoverage,
} from "@/lib/populace/coverage";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    // Resolve the pointer once so the three artifacts read the same release and
    // don't each re-fetch latest.json.
    const releaseId =
      release && release !== "latest"
        ? release
        : (await loadPointerReleaseId(revalidate, country)).release_id;
    const [source, inputColumns, reformSmoke] = await Promise.all([
      loadSourceCoverage(releaseId, revalidate, country),
      loadInputColumnCoverage(releaseId, revalidate, country),
      loadReformSmoke(releaseId, revalidate, country),
    ]);
    return NextResponse.json(
      scrub({
        release_id: releaseId,
        source,
        input_columns: inputColumns,
        reform_smoke: reformSmoke,
      }),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
