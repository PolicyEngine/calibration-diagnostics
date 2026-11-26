import { NextResponse } from "next/server";

import { requiredCountry } from "@/lib/api/request-country";
import {
  DEFAULT_RELEASE_HISTORY_ROUTE_DEPENDENCIES,
  readFailureResponse,
  RELEASE_HISTORY_CACHE_HEADERS,
  type ReleaseHistoryRouteDependencies,
} from "@/lib/microcosm/release-history-http";
import { readReleaseHistoryManifest } from "@/lib/microcosm/release-history-read";
import { releaseHistorySummary } from "@/lib/microcosm/release-history-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The release history page's first read: a country's panels, one per reference engine, and the
// panel the page opens. It is read from the manifest in private Blob; a country with no measured
// file yet answers `available: false`, never another country's panels.
export function createReleaseHistorySummaryHandler(
  dependencies: ReleaseHistoryRouteDependencies = DEFAULT_RELEASE_HISTORY_ROUTE_DEPENDENCIES,
) {
  return async function GET(request: Request) {
    const country = requiredCountry(new URL(request.url).searchParams);
    if (country instanceof Response) return country;
    try {
      const manifest = await readReleaseHistoryManifest(dependencies.store());
      return NextResponse.json(releaseHistorySummary(country, manifest), {
        headers: RELEASE_HISTORY_CACHE_HEADERS,
      });
    } catch (error) {
      return readFailureResponse(error);
    }
  };
}

export const GET = createReleaseHistorySummaryHandler();
