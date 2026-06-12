import { NextResponse } from "next/server";

import {
  LATEST_POPULACE_BUILD_MANIFEST_PATH,
  LATEST_POPULACE_COMPARISON_SUMMARY_PATH,
  LATEST_POPULACE_RELEASE_ID,
  LATEST_POPULACE_RELEASE_MANIFEST_PATH,
  LATEST_POPULACE_TARGET_DIAGNOSTICS_PATH,
  latestPopulaceBuildManifest,
  latestPopulaceComparisonSummary,
  latestPopulaceReleaseManifest,
  latestPopulaceTargetDiagnosticsSummary,
  scrub,
} from "@/lib/populace/latest-artifact";

const HF_REPO = process.env.POPULACE_HF_REPO ?? "policyengine/populace-us";
const HF_REVISION = process.env.POPULACE_HF_REVISION ?? "main";
const HF_API = "https://huggingface.co/api/datasets";

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

interface ReleaseEntry {
  release_id: string;
  files: string[];
}

async function listReleases(): Promise<ReleaseEntry[]> {
  const tree = await fetchJson(
    `${HF_API}/${HF_REPO}/tree/${HF_REVISION}/releases?recursive=true`,
  );
  if (!Array.isArray(tree)) return [];
  const releases = new Map<string, string[]>();
  for (const entry of tree) {
    const item = asObject(entry);
    if (item.type !== "file" || typeof item.path !== "string") continue;
    const match = item.path.match(/^releases\/([^/]+)\/(.+)$/);
    if (!match) continue;
    const files = releases.get(match[1]) ?? [];
    files.push(match[2]);
    releases.set(match[1], files);
  }
  return [...releases.entries()]
    .map(([release_id, files]) => ({ release_id, files }))
    .sort((a, b) => a.release_id.localeCompare(b.release_id));
}

async function loadLiveRelease(): Promise<JsonObject> {
  try {
    const releases = await listReleases();
    // Prefer the snapshot's release when it is published; otherwise the
    // lexicographically-latest complete release. Build ids end in a date,
    // but same-day builds have no published ordering — a latest.json
    // pointer in the repo would make this resolution exact.
    const complete = releases.filter((release) =>
      release.files.includes("build_manifest.json"),
    );
    const live =
      complete.find((r) => r.release_id === LATEST_POPULACE_RELEASE_ID) ??
      complete[complete.length - 1] ??
      null;
    if (!live) {
      return {
        available: false,
        reason: "No release with a build_manifest.json found on Hugging Face.",
        releases,
      };
    }
    const prefix = `releases/${live.release_id}`;
    const buildManifest = asObject(
      await fetchJson(hfResolveUrl(`${prefix}/build_manifest.json`)),
    );
    const releaseManifest = live.files.includes("release_manifest.json")
      ? asObject(await fetchJson(hfResolveUrl(`${prefix}/release_manifest.json`)))
      : {};
    return {
      available: true,
      source: "huggingface_live",
      repo_id: HF_REPO,
      revision: HF_REVISION,
      release_id: live.release_id,
      releases,
      build_manifest: buildManifest,
      release_manifest: releaseManifest,
      comparison_url: live.files.includes("sound_ecps_replacement_comparison.json")
        ? hfResolveUrl(`${prefix}/sound_ecps_replacement_comparison.json`)
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
    const releases = Array.isArray(live.releases) ? live.releases : [];
    const comparison = latestPopulaceComparisonSummary();
    const comparisonIsStale =
      releaseId !== String(comparison.release_id ?? LATEST_POPULACE_RELEASE_ID);

    return NextResponse.json(
      scrub({
        source_repo: HF_REPO,
        repo_type: "dataset",
        revision: HF_REVISION,
        source: liveAvailable ? "huggingface_live" : "deployed_static_snapshot",
        live_unavailable_reason: liveAvailable ? null : live.reason ?? null,
        release_id: releaseId,
        snapshot_release_id: LATEST_POPULACE_RELEASE_ID,
        releases,
        source_artifacts: [
          {
            name: "build_manifest",
            path: liveAvailable
              ? `releases/${releaseId}/build_manifest.json`
              : LATEST_POPULACE_BUILD_MANIFEST_PATH,
            url: liveAvailable
              ? hfResolveUrl(`releases/${releaseId}/build_manifest.json`)
              : "deployed-static-snapshot",
          },
          {
            name: "release_manifest",
            path: liveAvailable
              ? `releases/${releaseId}/release_manifest.json`
              : LATEST_POPULACE_RELEASE_MANIFEST_PATH,
            url: liveAvailable
              ? hfResolveUrl(`releases/${releaseId}/release_manifest.json`)
              : "deployed-static-snapshot",
          },
          {
            name: "sound_ecps_replacement_comparison",
            path: LATEST_POPULACE_COMPARISON_SUMMARY_PATH,
            url:
              typeof live.comparison_url === "string"
                ? live.comparison_url
                : "deployed-static-snapshot",
          },
          {
            name: "target_diagnostics",
            path: LATEST_POPULACE_TARGET_DIAGNOSTICS_PATH,
            url: "deployed-static-snapshot",
          },
        ],
        limitations: [
          "Build and release manifests are read live from the policyengine/populace-us Hugging Face dataset when reachable; per-target diagnostics come from a deployed static snapshot of sound_ecps_replacement_comparison.json.",
          "populace does not yet publish a latest.json pointer, so the live release is resolved by listing the releases/ tree and picking the lexicographically latest complete release (PolicyEngine/populace#9).",
          "Calibration internals (loss trajectory, skipped targets, per-record L0 gates) are computed by populace-calibrate but not published, so the dashboard cannot show convergence or skip reasons yet (PolicyEngine/populace#10).",
        ],
        comparison_snapshot_stale: comparisonIsStale,
        build_manifest: buildManifest,
        release_manifest: releaseManifest,
        gates: asObject(buildManifest.gates),
        score_vs_enhanced_cps: asObject(buildManifest.score_vs_enhanced_cps),
        comparison,
        target_diagnostics: latestPopulaceTargetDiagnosticsSummary(100),
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
