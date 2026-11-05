import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import { readCalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-blob";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import {
  loadPointerReleaseId,
  loadPublishedCutReleases,
  loadReleases,
  loadReleasesRecord,
  mergeReleaseInventory,
  recordedReleaseInventory,
  scrub,
  type ReleaseEntry,
} from "@policyengine/calibration-tree/latest-artifact";
import type { ReleasesRecord } from "@policyengine/calibration-tree/release-record";

export const revalidate = 60;

interface MicrocosmReleasesRouteDependencies {
  loadReleasesRecord: typeof loadReleasesRecord;
  loadReleases: typeof loadReleases;
  loadPointerReleaseId: typeof loadPointerReleaseId;
  readManifest: typeof readCalibrationTreeManifest;
  loadPublishedCutReleases: typeof loadPublishedCutReleases;
}

export function createMicrocosmReleasesHandler(
  dependencies: MicrocosmReleasesRouteDependencies = {
    loadReleasesRecord,
    loadReleases,
    loadPointerReleaseId,
    readManifest: readCalibrationTreeManifest,
    loadPublishedCutReleases,
  },
) {
  // A repository with releases.json lists the builds it names and nothing
  // else; which of them are calibrated comes from the dashboard manifest, so
  // the listing needs it.
  async function recordedInventory(country: MicrocosmCountry, record: ReleasesRecord) {
    const { manifest } = await dependencies.readManifest();
    return recordedReleaseInventory(record, country, manifest);
  }

  // A repository without releases.json lists the folders on main beside its
  // published tagged builds.
  async function folderInventory(
    country: MicrocosmCountry,
    latestReleaseId: Promise<string | null>,
  ): Promise<ReleaseEntry[]> {
    const [folders, manifest, latest] = await Promise.all([
      dependencies.loadReleases(revalidate, country),
      dependencies.readManifest()
        .then(({ manifest }) => manifest)
        .catch(() => null),
      latestReleaseId,
    ]);
    // Per-attempt tags and releases published only as a tag are named only
    // by the dashboard manifest; without it the picker keeps the folder
    // listing.
    const cuts = manifest
      ? await dependencies
        .loadPublishedCutReleases(revalidate, country, manifest, folders)
        .catch(() => [])
      : [];
    return mergeReleaseInventory(folders, cuts, latest);
  }

  return async function GET(request: Request) {
    const country = requestedCountry(new URL(request.url).searchParams);
    if (country instanceof Response) return country;
    try {
      // The dashboard's latest release, from its manifest.
      const pointerRead = dependencies.loadPointerReleaseId(revalidate, country)
        .catch(() => ({ release_id: "", updated_at: null }));
      // releases.json decides which listing applies. One that cannot be read
      // or is refused fails the request: tags and pointer files are never
      // read in its place.
      const inventory = dependencies.loadReleasesRecord(revalidate, country).then((record) =>
        record
          ? recordedInventory(country, record)
          : folderInventory(country, pointerRead.then((read) => read.release_id || null))
      );
      const [pointer, releases] = await Promise.all([pointerRead, inventory]);
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
