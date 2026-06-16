import { NextResponse } from "next/server";

import {
  latestPopulaceTargetDiagnosticsPage,
  loadLiveCalibration,
  scrub,
  snapshotCalibration,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  // Resolve the per-target diagnostics live from HF (via latest.json); fall back
  // to the committed snapshot when HF is unreachable.
  const live = await loadLiveCalibration(revalidate);
  const calibration = live?.calibration ?? snapshotCalibration();
  return NextResponse.json(
    scrub(latestPopulaceTargetDiagnosticsPage(request.url, calibration)),
  );
}
