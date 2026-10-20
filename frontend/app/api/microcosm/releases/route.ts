import { NextResponse } from "next/server";

import { readCalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-blob";
import { countryReleaseLayout } from "@policyengine/calibration-tree/countries";
import {
  loadPointerReleaseId,
  loadPublishedCutReleases,
  loadRecordedReleases,
  loadReleases,
  mergeReleaseInventory,
  parseCountry,
  scrub,
  type ReleaseEntry,
} from "@policyengine/calibration-tree/latest-artifact";

export const revalidate = 60;

interface MicrocosmReleasesRouteDependencies {
  releaseLayout: typeof countryReleaseLayout;
  loadRecordedReleases: typeof loadRecordedReleases;
  loadReleases: typeof loadReleases;
  loadPointerReleaseId: typeof loadPointerReleaseId;
  readManifest: typeof readCalibrationTreeManifest;
  loadPublishedCutReleases: typeof loadPublishedCutReleases;
}

export function createMicrocosmReleasesHandler(
  dependencies: MicrocosmReleasesRouteDependencies = {
    releaseLayout: countryReleaseLayout,
    loadRecordedReleases,
    loadReleases,
    loadPointerReleaseId,
    readManifest: readCalibrationTreeManifest,
    loadPublishedCutReleases,
  },
) {
  // A country publishing build folders lists the builds releases.json names
  // and nothing else; which of them are calibrated comes from the dashboard
  // manifest, so the listing needs it.
  async function recordedInventory(country: ReturnType<typeof parseCountry>) {
    const { manifest } = await dependencies.readManifest();
    return dependencies.loadRecordedReleases(revalidate, country, manifest);
  }

  // A country publishing release folders lists the folders on main beside
  // its published tagged builds.
  async function folderInventory(
    country: ReturnType<typeof parseCountry>,
    latestReleaseId: Promise<string | null>,
  ): Promise<ReleaseEntry[]> {
    const [folders, cuts, latest] = await Promise.all([
      dependencies.loadReleases(revalidate, country),
      // Published cuts are named only by the dashboard manifest; without it
      // the picker keeps the folder listing.
      dependencies.readManifest()
        .then(({ manifest }) =>
          dependencies.loadPublishedCutReleases(revalidate, country, manifest),
        )
        .catch(() => []),
      latestReleaseId,
    ]);
    return mergeReleaseInventory(folders, cuts, latest);
  }

  return async function GET(request: Request) {
    const country = parseCountry(new URL(request.url).searchParams.get("country"));
    try {
      // The dashboard's latest release, from its manifest.
      const pointerRead = dependencies.loadPointerReleaseId(revalidate, country)
        .catch(() => ({ release_id: "", updated_at: null }));
      const [pointer, releases] = await Promise.all([
        pointerRead,
        dependencies.releaseLayout(country) === "build_folders"
          ? recordedInventory(country)
          : folderInventory(country, pointerRead.then((read) => read.release_id || null)),
      ]);
      return NextResponse.json(
        scrub({
          latest_release_id: pointer.release_id,
          default_release_id: pointer.release_id,
          selection_mode: "dashboard_manifest",
          updated_at: pointer.updated_at,
          // Releases that carry the per-target diagnostics (compare-able).
          releases: releases.filter((r) => r.has_calibration),
          all_releases: releases,
        }),
      );
    } catch (error) {
      return NextResponse.json(
        { detail: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  };
}

export const GET = createMicrocosmReleasesHandler();
