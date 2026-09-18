import { NextResponse } from "next/server";

import { buildCalibrationTree, type CalibrationTreeTarget } from "@/lib/microcosm/calibration-tree";
import { calibrationTreeRequestState } from "@/lib/microcosm/calibration-tree-request";
import { classifyApiError, parseCountry, scrub } from "@/lib/microcosm/latest-artifact";
import { loadStagingCalibration } from "@/lib/microcosm/staging-artifact";

// Candidate calibration trees use the same six-hour cache interval as
// published calibration trees. Each staging run has its own URL and query key.
export const revalidate = 21_600;
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
        { status: 404 },
      );
    }
    return NextResponse.json(
      scrub(
        buildCalibrationTree(
          calibration.rows as CalibrationTreeTarget[],
          calibrationTreeRequestState(params),
          calibration.release_id,
          calibration.target_loss_attribution.status !== "unavailable",
          calibration.calibration_provenance,
        ),
      ),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
