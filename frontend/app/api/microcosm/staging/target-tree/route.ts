import { NextResponse } from "next/server";

import { buildCalibrationTree, type CalibrationTreeTarget } from "@/lib/microcosm/calibration-tree";
import { calibrationTreeRequestState } from "@/lib/microcosm/calibration-tree-request";
import { classifyApiError, parseCountry, scrub } from "@/lib/microcosm/latest-artifact";
import { loadStagingCalibration } from "@/lib/microcosm/staging-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const runId = params.get("run")?.trim();
  if (!runId) {
    return NextResponse.json({ detail: "Provide a staging run id via ?run=." }, { status: 400 });
  }
  const country = parseCountry(params.get("country"));
  try {
    const calibration = await loadStagingCalibration(runId, revalidate, country);
    if (!calibration) {
      return NextResponse.json(
        {
          detail: "This staging run has not uploaded calibration diagnostics yet.",
        },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    return NextResponse.json(
      scrub(
        buildCalibrationTree(
          calibration.rows as CalibrationTreeTarget[],
          calibrationTreeRequestState(params),
          calibration.release_id,
          calibration.target_loss_attribution.status !== "unavailable",
        ),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
