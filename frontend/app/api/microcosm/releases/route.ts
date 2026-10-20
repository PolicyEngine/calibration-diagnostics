import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import { readCalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-blob";
import {
  loadPointerReleaseId,
  loadPublishedCutReleases,
  loadReleases,
  mergeReleaseInventory,
  scrub,
} from "@policyengine/calibration-tree/latest-artifact";

export const revalidate = 60;

interface MicrocosmReleasesRouteDependencies {
  loadReleases: typeof loadReleases;
  loadPointerReleaseId: typeof loadPointerReleaseId;
  readManifest: typeof readCalibrationTreeManifest;
  loadPublishedCutReleases: typeof loadPublishedCutReleases;
}

export function createMicrocosmReleasesHandler(
  dependencies: MicrocosmReleasesRouteDependencies = {
    loadReleases,
    loadPointerReleaseId,
    readManifest: readCalibrationTreeManifest,
    loadPublishedCutReleases,
  },
) {
  return async function GET(request: Request) {
    const country = requestedCountry(new URL(request.url).searchParams);
    if (country instanceof Response) return country;
    try {
      const [folders, pointer, cuts] = await Promise.all([
        dependencies.loadReleases(revalidate, country),
        dependencies.loadPointerReleaseId(revalidate, country).catch(() => ({ release_id: "", updated_at: null })),
        // Published cuts are named only by the dashboard manifest; without it
        // the picker keeps the folder listing.
        dependencies.readManifest()
          .then(({ manifest }) =>
            dependencies.loadPublishedCutReleases(revalidate, country, manifest),
          )
          .catch(() => []),
      ]);
      const releases = mergeReleaseInventory(folders, cuts, pointer.release_id || null);
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
