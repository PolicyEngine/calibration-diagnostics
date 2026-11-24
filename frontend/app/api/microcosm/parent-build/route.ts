import { NextResponse } from "next/server";

import {
  countryNotConfiguredResponse,
  requiredCountry,
} from "@/lib/api/request-country";
import {
  parentBuildFromManifest,
  type ParentBuildResponse,
} from "@/lib/microcosm/inherited-calibration";
import { isReleaseId } from "@policyengine/calibration-tree/calibration-release-locator";
import { CountryNotConfiguredError } from "@policyengine/calibration-tree/countries";
import { isBuildFolderId } from "@policyengine/calibration-tree/release-record";
import {
  loadStoredParentBuildManifest,
  resolveStoredRelease,
} from "@/lib/microcosm/collector-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// As long as the release route allows, so a slow store read ends in this
// route's 502.
export const maxDuration = 300;

// The file is the store's copy of the one the build was published with,
// whose bytes never change, so the CDN keeps the answer for an hour.
const ANSWER_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "public, max-age=3600, stale-if-error=86400",
};
const NO_STORE = { "Cache-Control": "no-store" };

export interface ParentBuildRouteDependencies {
  resolveRelease(
    country: Parameters<typeof resolveStoredRelease>[0],
    release: string,
  ): ReturnType<typeof resolveStoredRelease>;
  loadParentManifest: typeof loadStoredParentBuildManifest;
}

// The build whose calibration a release build inherits, and that build's
// staging run, from the `parent_build_manifest.json` a compatibility
// recertification carries in its folder, read from the collector's copy of
// the build's files. The build comes from the calibration tree manifest,
// never from the request.
export function createParentBuildHandler(
  dependencies: ParentBuildRouteDependencies = {
    resolveRelease: resolveStoredRelease,
    loadParentManifest: loadStoredParentBuildManifest,
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
      location = await dependencies.resolveRelease(country, release);
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
      const manifest = await dependencies.loadParentManifest(location, country);
      const body: ParentBuildResponse = {
        release_id: location.releaseId,
        ...parentBuildFromManifest(manifest),
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
