import { NextResponse } from "next/server";

import {
  LATEST_POPULACE_BUILD_MANIFEST_PATH,
  LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH,
  LATEST_POPULACE_RELEASE_ID,
  LATEST_POPULACE_RELEASE_MANIFEST_PATH,
  latestPopulaceBuildManifest,
  latestPopulaceCalibrationHighlights,
  latestPopulaceCalibrationSummary,
  latestPopulaceReleaseManifest,
  scrub,
} from "@/lib/populace/latest-artifact";

const HF_REPO = process.env.POPULACE_HF_REPO ?? "policyengine/populace-us";
const HF_REVISION = process.env.POPULACE_HF_REVISION ?? "main";
const LATEST_POINTER_PATH = "latest.json";

type JsonObject = Record<string, unknown>;

export const revalidate = 300;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function hfResolveUrl(path: string): string {
  return `https://huggingface.co/datasets/${HF_REPO}/resolve/${HF_REVISION}/${path}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { next: { revalidate } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

// Resolve the current release through latest.json — the published pointer
// (PolicyEngine/populace#9). Its `paths` name the build/release manifests for
// the release it points at; we read those small files live and leave the large
// per-target diagnostics to the deployed snapshot.
async function loadLiveRelease(): Promise<JsonObject> {
  try {
    const pointer = asObject(await fetchJson(hfResolveUrl(LATEST_POINTER_PATH)));
    const releaseId = pointer.release_id;
    const paths = asObject(pointer.paths);
    if (typeof releaseId !== "string" || !releaseId) {
      return { available: false, reason: "latest.json has no release_id." };
    }
    const buildManifestPath =
      typeof paths.build_manifest === "string"
        ? paths.build_manifest
        : `releases/${releaseId}/build_manifest.json`;
    const releaseManifestPath =
      typeof paths.release_manifest === "string"
        ? paths.release_manifest
        : `releases/${releaseId}/release_manifest.json`;
    const buildManifest = asObject(await fetchJson(hfResolveUrl(buildManifestPath)));
    let releaseManifest: JsonObject = {};
    try {
      releaseManifest = asObject(await fetchJson(hfResolveUrl(releaseManifestPath)));
    } catch {
      releaseManifest = {};
    }
    return {
      available: true,
      source: "huggingface_live",
      repo_id: HF_REPO,
      revision: HF_REVISION,
      release_id: releaseId,
      updated_at: pointer.updated_at ?? null,
      pointer,
      build_manifest: buildManifest,
      release_manifest: releaseManifest,
      build_manifest_path: buildManifestPath,
      release_manifest_path: releaseManifestPath,
      calibration_diagnostics_path:
        typeof paths.calibration_diagnostics === "string"
          ? paths.calibration_diagnostics
          : null,
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  try {
    const live = await loadLiveRelease();
    const liveAvailable = live.available === true;
    const buildManifest = liveAvailable
      ? asObject(live.build_manifest)
      : latestPopulaceBuildManifest();
    const releaseManifest =
      liveAvailable && Object.keys(asObject(live.release_manifest)).length
        ? asObject(live.release_manifest)
        : latestPopulaceReleaseManifest();
    const releaseId = liveAvailable
      ? String(live.release_id)
      : LATEST_POPULACE_RELEASE_ID;
    const calibration = latestPopulaceCalibrationSummary();
    const highlights = latestPopulaceCalibrationHighlights(15);
    const calibrationSnapshotStale =
      releaseId !== String(calibration.release_id ?? LATEST_POPULACE_RELEASE_ID);

    return NextResponse.json(
      scrub({
        source_repo: HF_REPO,
        repo_type: "dataset",
        revision: HF_REVISION,
        source: liveAvailable ? "huggingface_live" : "deployed_static_snapshot",
        live_unavailable_reason: liveAvailable ? null : live.reason ?? null,
        release_id: releaseId,
        snapshot_release_id: LATEST_POPULACE_RELEASE_ID,
        updated_at: liveAvailable ? live.updated_at ?? null : null,
        source_artifacts: [
          {
            name: "latest_pointer",
            path: LATEST_POINTER_PATH,
            url: liveAvailable
              ? hfResolveUrl(LATEST_POINTER_PATH)
              : "deployed-static-snapshot",
          },
          {
            name: "build_manifest",
            path: liveAvailable
              ? String(live.build_manifest_path)
              : LATEST_POPULACE_BUILD_MANIFEST_PATH,
            url: liveAvailable
              ? hfResolveUrl(String(live.build_manifest_path))
              : "deployed-static-snapshot",
          },
          {
            name: "release_manifest",
            path: liveAvailable
              ? String(live.release_manifest_path)
              : LATEST_POPULACE_RELEASE_MANIFEST_PATH,
            url: liveAvailable
              ? hfResolveUrl(String(live.release_manifest_path))
              : "deployed-static-snapshot",
          },
          {
            name: "calibration_diagnostics",
            path: LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH,
            url:
              liveAvailable && typeof live.calibration_diagnostics_path === "string"
                ? hfResolveUrl(live.calibration_diagnostics_path)
                : "deployed-static-snapshot",
          },
        ],
        limitations: [
          "Build and release manifests are read live from the policyengine/populace-us Hugging Face dataset via latest.json; per-target calibration diagnostics come from a deployed static snapshot of calibration_diagnostics.json.",
          "The eCPS head-to-head comparison moved out of live populace into PolicyEngine/populace-benchmarks, so this view reports populace's calibration fit against its own target surface, not a populace-vs-enhanced-CPS score.",
          "The published loss trajectory for this release was reconstructed from saved scalars (the historical build did not store the full epoch trace), so the convergence curve is coarse — see the solver provenance note.",
        ],
        calibration_snapshot_stale: calibrationSnapshotStale,
        build_manifest: buildManifest,
        release_manifest: releaseManifest,
        gates: asObject(buildManifest.gates),
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
