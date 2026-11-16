import { NextResponse } from "next/server";

import {
  countryNotConfiguredResponse,
  requiredCountry,
} from "@/lib/api/request-country";
import {
  PARENT_BUILD_MANIFEST_FILE,
  parentBuildFromManifest,
  type ParentBuildResponse,
} from "@/lib/microcosm/inherited-calibration";
import {
  isReleaseId,
  resolveCalibrationRelease,
} from "@policyengine/calibration-tree/calibration-release-locator";
import { CountryNotConfiguredError } from "@policyengine/calibration-tree/countries";
import { loadCountryRepositoryHashedJson } from "@policyengine/calibration-tree/latest-artifact";
import { isBuildFolderId } from "@policyengine/calibration-tree/release-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The file is read at the build's pinned commit, where its bytes never
// change, so the read is cached for a day. The release's tree may be
// republished at another commit, so the CDN keeps the answer for an hour.
const PARENT_MANIFEST_REVALIDATE_SECONDS = 86_400;
const ANSWER_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "public, max-age=3600, stale-if-error=86400",
};
const NO_STORE = { "Cache-Control": "no-store" };

export interface ParentBuildRouteDependencies {
  resolveRelease: typeof resolveCalibrationRelease;
  loadJson: typeof loadCountryRepositoryHashedJson;
}

// The build whose calibration a release build inherits, and that build's
// staging run, from the `parent_build_manifest.json` a compatibility
// recertification carries in its folder. The folder and commit come from the
// calibration tree manifest, never from the request.
export function createParentBuildHandler(
  dependencies: ParentBuildRouteDependencies = {
    resolveRelease: resolveCalibrationRelease,
    loadJson: loadCountryRepositoryHashedJson,
  },
) {
  return async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const country = requiredCountry(params);
    if (country instanceof Response) return country;
    const release = params.get("release")?.trim() ?? "";
    if (!isReleaseId(release) && !isBuildFolderId(release)) {
      return NextResponse.json(
        { detail: "Provide a release build via ?release=." },
        { status: 400, headers: NO_STORE },
      );
    }

    let location;
    try {
      location = await dependencies.resolveRelease(country, release, 3600);
    } catch (error) {
      if (error instanceof CountryNotConfiguredError) {
        return countryNotConfiguredResponse(error);
      }
      const missing =
        error instanceof Error && error.message.startsWith("No matching calibration build");
      if (!missing) console.error("Calibration release resolution failed:", error);
      return NextResponse.json(
        {
          detail: missing
            ? "Calibration release was not found."
            : "Calibration release is unavailable.",
        },
        { status: missing ? 404 : 503, headers: NO_STORE },
      );
    }

    try {
      const manifest = await dependencies.loadJson(
        `releases/${location.releaseDirectory}/${PARENT_BUILD_MANIFEST_FILE}`,
        PARENT_MANIFEST_REVALIDATE_SECONDS,
        country,
        location.hfCommitSha,
      );
      const body: ParentBuildResponse = {
        release_id: location.releaseId,
        ...parentBuildFromManifest(manifest?.payload ?? null),
      };
      return NextResponse.json(body, { headers: ANSWER_CACHE_HEADERS });
    } catch (error) {
      console.error("Parent build manifest read failed:", error);
      return NextResponse.json(
        { detail: "The parent build manifest is unavailable." },
        { status: 502, headers: NO_STORE },
      );
    }
  };
}

export const GET = createParentBuildHandler();
