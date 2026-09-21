import { NextResponse } from "next/server";

import { calibrationTreeRequestState } from "@/lib/microcosm/calibration-tree-request";
import {
  classifyApiError,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";
import { isSha256 } from "@/lib/microcosm/calibration-tree-artifact";
import {
  loadStagingTargetChangeDataset,
  loadStagingTargetChangeDatasetFromBuild,
} from "@/lib/microcosm/staging-artifact";
import type { TargetChangeMode } from "@/lib/microcosm/target-change";
import { buildTargetChangeTree } from "@/lib/microcosm/target-change-tree";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export interface StagingTargetChangeTreeRouteDependencies {
  loadReleaseDataset: typeof loadStagingTargetChangeDataset;
  loadBuildDataset: typeof loadStagingTargetChangeDatasetFromBuild;
}

export function createStagingTargetChangeTreeHandler(
  dependencies: StagingTargetChangeTreeRouteDependencies = {
    loadReleaseDataset: loadStagingTargetChangeDataset,
    loadBuildDataset: loadStagingTargetChangeDatasetFromBuild,
  },
) {
  return async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const runId = params.get("run")?.trim();
    const releaseId = params.get("release")?.trim();
    const currentBuildArtifactId = params.get("build")?.trim();
    const requestedMode = params.get("mode")?.trim() || "reported";
    if (!runId) {
      return NextResponse.json(
        { detail: "Provide a staging run id via ?run=." },
        { status: 400 },
      );
    }
    if (releaseId && currentBuildArtifactId) {
      return NextResponse.json(
        { detail: "Specify either a current release or a current build, not both." },
        { status: 400 },
      );
    }
    if (
      (!releaseId && !currentBuildArtifactId) ||
      releaseId === "latest" ||
      (currentBuildArtifactId != null && !isSha256(currentBuildArtifactId))
    ) {
      return NextResponse.json(
        { detail: "Provide an exact current release id or build artifact id." },
        { status: 400 },
      );
    }
    if (requestedMode !== "reported" && requestedMode !== "shared") {
      return NextResponse.json(
        { detail: "Comparison mode must be reported or shared." },
        { status: 400 },
      );
    }
    const mode = requestedMode as TargetChangeMode;
    const country = parseCountry(params.get("country"));
    try {
      const dataset = currentBuildArtifactId
        ? await dependencies.loadBuildDataset(
            runId,
            currentBuildArtifactId,
            country,
          )
        : await dependencies.loadReleaseDataset(runId, releaseId!, country);
      if (!dataset) {
        return NextResponse.json(
          {
            available: false,
            reason: "This staging run has not uploaded calibration diagnostics yet.",
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        scrub(
          buildTargetChangeTree(
            dataset,
            calibrationTreeRequestState(params),
            mode,
          ),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      const { status, body } = classifyApiError(error);
      return NextResponse.json(body, { status });
    }
  };
}

export const GET = createStagingTargetChangeTreeHandler();
