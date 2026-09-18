import { NextResponse } from "next/server";
import { withBasePath } from "@/lib/base-path";

import {
  asObject,
  classifyApiError,
  hfResolveUrl,
  latestMicrocosmCalibrationHighlights,
  latestMicrocosmCalibrationSummary,
  loadRelease,
  parseCountry,
  microcosmRepo,
  scrub,
} from "@/lib/microcosm/latest-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const isLatestRequest = release === "latest" || release === "";
  const country = parseCountry(params.get("country"));
  try {
    const cal = await loadRelease(release, revalidate, country);
    const calibration = latestMicrocosmCalibrationSummary(cal);
    const highlights = latestMicrocosmCalibrationHighlights(cal, 15);
    const prefix = `releases/${cal.release_id}`;
    const sourceUrl = (path: string) =>
      hfResolveUrl(path, country, cal.hf_commit_sha ?? undefined);
    return NextResponse.json(
      scrub({
        source_repo: microcosmRepo(country),
        repo_type: "dataset",
        revision: cal.hf_commit_sha,
        source:
          cal.source === "local_filesystem"
            ? "local_filesystem"
            : "huggingface_immutable",
        selection_mode: isLatestRequest
          ? "dashboard_manifest"
          : "historical_release_tag",
        release_id: cal.release_id,
        updated_at: cal.updated_at,
        source_artifacts:
          cal.source === "local_filesystem"
            ? []
            : [
                ...(isLatestRequest
                  ? [{
                      name: "dashboard_manifest",
                      path: "calibration-trees/manifest.json",
                      url: new URL(
                        withBasePath(`/api/microcosm/tree-manifest?country=${country}`),
                        request.url,
                      ).toString(),
                    }]
                  : []),
                { name: "build_manifest", path: `${prefix}/build_manifest.json`, url: sourceUrl(`${prefix}/build_manifest.json`) },
                { name: "release_manifest", path: `${prefix}/release_manifest.json`, url: sourceUrl(`${prefix}/release_manifest.json`) },
                { name: "calibration_diagnostics", path: `${prefix}/calibration_diagnostics.json`, url: sourceUrl(`${prefix}/calibration_diagnostics.json`) },
                { name: "demographics", path: `${prefix}/demographics.json`, url: sourceUrl(`${prefix}/demographics.json`) },
              ],
        limitations: [
          cal.source === "local_filesystem"
            ? "This page reads the configured local calibration artifacts."
            : isLatestRequest
              ? `This page resolves the dashboard's current release through its version manifest, then reads ${microcosmRepo(country)} at immutable commit ${cal.hf_commit_sha}.`
              : `This page resolves release ${cal.release_id} to immutable Hugging Face commit ${cal.hf_commit_sha}.`,
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
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
