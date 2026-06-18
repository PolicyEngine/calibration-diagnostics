import { NextResponse } from "next/server";

import {
  POPULACE_HF_REPO,
  POPULACE_HF_REVISION,
  asObject,
  hfResolveUrl,
  latestPopulaceCalibrationHighlights,
  latestPopulaceCalibrationSummary,
  loadRelease,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const release = new URL(request.url).searchParams.get("release") ?? "latest";
  try {
    const cal = await loadRelease(release, revalidate);
    const calibration = latestPopulaceCalibrationSummary(cal);
    const highlights = latestPopulaceCalibrationHighlights(cal, 15);
    const prefix = `releases/${cal.release_id}`;
    return NextResponse.json(
      scrub({
        source_repo: POPULACE_HF_REPO,
        repo_type: "dataset",
        revision: POPULACE_HF_REVISION,
        source: "huggingface_live",
        release_id: cal.release_id,
        updated_at: cal.updated_at,
        source_artifacts: [
          { name: "latest_pointer", path: "latest.json", url: hfResolveUrl("latest.json") },
          { name: "build_manifest", path: `${prefix}/build_manifest.json`, url: hfResolveUrl(`${prefix}/build_manifest.json`) },
          { name: "release_manifest", path: `${prefix}/release_manifest.json`, url: hfResolveUrl(`${prefix}/release_manifest.json`) },
          { name: "calibration_diagnostics", path: `${prefix}/calibration_diagnostics.json`, url: hfResolveUrl(`${prefix}/calibration_diagnostics.json`) },
        ],
        limitations: [
          "Everything on this page is read live from the policyengine/populace-us Hugging Face dataset; the current release is resolved through latest.json.",
          "Loss values are the calibrator's own metric for this release; their scale is not comparable across releases that calibrate to different target surfaces.",
        ],
        build_manifest: cal.build_manifest,
        release_manifest: cal.release_manifest,
        gates: asObject(cal.build_manifest.gates),
        calibration,
        highlights,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
