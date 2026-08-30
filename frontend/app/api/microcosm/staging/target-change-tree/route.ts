import { NextResponse } from "next/server";

import { calibrationTreeRequestState } from "@/lib/microcosm/calibration-tree-request";
import {
  classifyApiError,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";
import { loadStagingTargetChangeDataset } from "@/lib/microcosm/staging-artifact";
import type { TargetChangeMode } from "@/lib/microcosm/target-change";
import { buildTargetChangeTree } from "@/lib/microcosm/target-change-tree";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const runId = params.get("run")?.trim();
  const releaseId = params.get("release")?.trim();
  const requestedMode = params.get("mode")?.trim() || "reported";
  if (!runId) {
    return NextResponse.json(
      { detail: "Provide a staging run id via ?run=." },
      { status: 400 },
    );
  }
  if (!releaseId || releaseId === "latest") {
    return NextResponse.json(
      { detail: "Provide the resolved current release id via ?release=." },
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
    const dataset = await loadStagingTargetChangeDataset(
      runId,
      releaseId,
      country,
    );
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
}
