import { NextResponse } from "next/server";

import { hasCapability, type MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import {
  parseCountry,
  scrub,
} from "@policyengine/calibration-tree/latest-artifact";
import {
  loadStagingComparison,
  resolveStagingComparisonRelease,
  type StagingComparison,
  type StagingComparisonRelease,
} from "@policyengine/calibration-tree/staging-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export interface StagingCompareRouteDependencies {
  resolveComparisonRelease(
    runId: string,
    country: MicrocosmCountry,
  ): Promise<StagingComparisonRelease>;
  loadComparison(
    runId: string,
    releaseId: string,
    revalidate: number,
    country: MicrocosmCountry,
  ): Promise<StagingComparison>;
}

export function createStagingCompareHandler(
  dependencies: StagingCompareRouteDependencies = {
    resolveComparisonRelease: (runId, country) =>
      resolveStagingComparisonRelease(runId, country),
    loadComparison: loadStagingComparison,
  },
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const country = parseCountry(url.searchParams.get("country"));
    const runId = url.searchParams.get("run")?.trim();
    let release = url.searchParams.get("release")?.trim() || "latest";
    if (!runId && hasCapability(country, "staging")) {
      return NextResponse.json({ detail: "Provide a staging run id via ?run=." }, { status: 400 });
    }
    try {
      // "latest" is the current release for a national candidate and the
      // newest published local-area release for a local-area candidate; the
      // response names the local-area choice so the page can say so.
      let comparisonRelease: StagingComparisonRelease | null = null;
      if (release === "latest" && hasCapability(country, "staging")) {
        comparisonRelease = await dependencies.resolveComparisonRelease(runId ?? "", country);
        release = comparisonRelease.release_id;
      }
      const comparison = await dependencies.loadComparison(runId ?? "", release, revalidate, country);
      return NextResponse.json(
        scrub(
          comparisonRelease?.local_area_candidate
            ? { ...comparison, comparison_release: comparisonRelease }
            : comparison,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return NextResponse.json(
        { detail: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  };
}

export const GET = createStagingCompareHandler();
