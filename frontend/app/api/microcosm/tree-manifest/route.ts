import { NextResponse } from "next/server";

import {
  countryNotConfiguredResponse,
  requiredCountry,
} from "@/lib/api/request-country";
import { readCalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-blob";
import { calibrationTreeCountryManifest } from "@policyengine/calibration-tree/calibration-tree-manifest";
import { CountryNotConfiguredError } from "@policyengine/calibration-tree/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANIFEST_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "public, max-age=60, stale-if-error=86400",
};

interface CalibrationTreeManifestRouteDependencies {
  readManifest: typeof readCalibrationTreeManifest;
}

export function createCalibrationTreeManifestHandler(
  dependencies: CalibrationTreeManifestRouteDependencies = {
    readManifest: readCalibrationTreeManifest,
  },
) {
  return async function GET(request: Request) {
    const countryValue = requiredCountry(new URL(request.url).searchParams);
    if (countryValue instanceof Response) return countryValue;
    try {
      const { manifest } = await dependencies.readManifest();
      const countryManifest = calibrationTreeCountryManifest(
        manifest,
        countryValue,
      );
      return NextResponse.json(
        {
          schemaVersion: manifest.schemaVersion,
          country: countryValue,
          ...countryManifest,
        },
        { headers: MANIFEST_CACHE_HEADERS },
      );
    } catch (error) {
      if (error instanceof CountryNotConfiguredError) {
        return countryNotConfiguredResponse(error);
      }
      console.error("Calibration tree manifest read failed:", error);
      return NextResponse.json(
        { detail: "No published calibration tree is available." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const GET = createCalibrationTreeManifestHandler();
