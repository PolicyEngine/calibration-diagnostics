import { NextResponse } from "next/server";

import { readCalibrationTreeManifest } from "@/lib/microcosm/calibration-tree-blob";
import { calibrationTreeCountryManifest } from "@/lib/microcosm/calibration-tree-manifest";
import {
  isCountry,
  selectableCountries,
} from "@/lib/microcosm/countries";

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
    const countryValue = new URL(request.url).searchParams.get("country");
    if (
      !isCountry(countryValue) ||
      !selectableCountries().includes(countryValue)
    ) {
      return NextResponse.json(
        { detail: "Unknown calibration country." },
        { status: 400 },
      );
    }
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
      console.error("Calibration tree manifest read failed:", error);
      return NextResponse.json(
        { detail: "No published calibration tree is available." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const GET = createCalibrationTreeManifestHandler();
