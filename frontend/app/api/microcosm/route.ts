import { NextResponse } from "next/server";
import { countryRegistration } from "@/lib/microcosm/countries";
import { stagingRunIdOf } from "@/lib/microcosm/calibration-selection";

import {
  asObject,
  classifyApiError,
  hfResolveUrl,
  latestMicrocosmCalibrationHighlights,
  latestMicrocosmCalibrationSummary,
  loadRelease,
  parseCountry,
  microcosmRepo,
  microcosmRevision,
  scrub,
} from "@/lib/microcosm/latest-artifact";
import {
  loadSelectedCalibration,
  stagingRepository,
  stagingResolveUrl,
} from "@/lib/microcosm/staging-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const isLatestRequest = release === "latest" || release === "";
  const country = parseCountry(params.get("country"));
  const productionRelease = countryRegistration(country).production_release_id;
  try {
    // An unreleased staging candidate (`staging:<run_id>`) reviewed with the
    // same page as a release: its diagnostics come from the run's telemetry
    // or from the dataset bundle the run staged, never from releases/.
    const stagingRunId = stagingRunIdOf(release);
    if (stagingRunId != null) {
      const cal = await loadSelectedCalibration(release, 0, country);
      const staging = stagingRepository(country);
      const runPrefix = `runs/${stagingRunId}`;
      const stagedBundle = cal.source === "huggingface_staged_bundle";
      return NextResponse.json(
        scrub({
          source_repo: staging?.repo ?? null,
          repo_type: "dataset",
          revision: staging?.revision ?? null,
          source: cal.source,
          selection_mode: "staging_candidate",
          staging_run_id: stagingRunId,
          release_id: cal.release_id,
          updated_at: cal.updated_at,
          source_artifacts: [
            { name: "run_manifest", path: `${runPrefix}/run_manifest.json`, url: stagingResolveUrl(`${runPrefix}/run_manifest.json`, country) },
            { name: "progress", path: `${runPrefix}/progress.json`, url: stagingResolveUrl(`${runPrefix}/progress.json`, country) },
          ],
          limitations: [
            stagedBundle
              ? `This is an unreleased staging candidate. Its calibration diagnostics are read from the dataset bundle the run staged under staged/${stagingRunId}/ in ${microcosmRepo(country)}, at the commit the run's receipt records. Nothing on this page has been published or promoted.`
              : `This is an unreleased staging candidate. Its calibration diagnostics were uploaded with the run's staging telemetry to ${staging?.repo ?? "the staging repository"}. Nothing on this page has been published or promoted.`,
            "Loss values are the calibrator's own metric for this candidate; their scale is not comparable across builds that calibrate to different target surfaces.",
          ],
          build_manifest: cal.build_manifest,
          release_manifest: cal.release_manifest,
          gates: asObject(cal.build_manifest.gates),
          calibration: latestMicrocosmCalibrationSummary(cal),
          highlights: latestMicrocosmCalibrationHighlights(cal, 15),
        }),
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const cal = await loadRelease(release, revalidate, country);
    const calibration = latestMicrocosmCalibrationSummary(cal);
    const highlights = latestMicrocosmCalibrationHighlights(cal, 15);
    const prefix = `releases/${cal.release_id}`;
    return NextResponse.json(
      scrub({
        source_repo: microcosmRepo(country),
        repo_type: "dataset",
        revision: microcosmRevision(country),
        source: productionRelease ? "huggingface_immutable" : "huggingface_live",
        selection_mode: productionRelease ? "pinned_production" : "latest",
        release_id: cal.release_id,
        updated_at: cal.updated_at,
        source_artifacts: [
          ...(isLatestRequest && !productionRelease
            ? [{ name: "latest_pointer", path: "latest.json", url: hfResolveUrl("latest.json", country) }]
            : []),
          { name: "build_manifest", path: `${prefix}/build_manifest.json`, url: hfResolveUrl(`${prefix}/build_manifest.json`, country) },
          { name: "release_manifest", path: `${prefix}/release_manifest.json`, url: hfResolveUrl(`${prefix}/release_manifest.json`, country) },
          { name: "calibration_diagnostics", path: `${prefix}/calibration_diagnostics.json`, url: hfResolveUrl(`${prefix}/calibration_diagnostics.json`, country) },
          { name: "demographics", path: `${prefix}/demographics.json`, url: hfResolveUrl(`${prefix}/demographics.json`, country) },
        ],
        limitations: [
          productionRelease
            ? `This page reads the selected release from immutable Hugging Face revision ${microcosmRevision(country)}. The production default is pinned to ${productionRelease}; it does not follow latest.json.`
            : isLatestRequest
            ? `Everything on this page is read live from the ${microcosmRepo(country)} Hugging Face dataset; the current release is resolved through latest.json.`
            : `Everything on this page is read live from the ${microcosmRepo(country)} Hugging Face dataset for the selected release id.`,
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
