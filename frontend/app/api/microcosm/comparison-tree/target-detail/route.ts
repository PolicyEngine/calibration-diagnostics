import { NextResponse } from "next/server";

import { loadCalibrationComparisonTargetDetail } from "@/lib/microcosm/calibration-comparison-blob";
import { isSha256 } from "@/lib/microcosm/calibration-tree-artifact";
import {
  isCountry,
  selectableCountries,
  type MicrocosmCountry,
} from "@/lib/microcosm/countries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IMMUTABLE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Vercel-CDN-Cache-Control": "public, max-age=31536000",
  "X-Content-Type-Options": "nosniff",
};

function countryParameter(url: URL): MicrocosmCountry | null {
  const value = url.searchParams.get("country");
  return isCountry(value) && selectableCountries().includes(value) ? value : null;
}

function targetOrdinalParameter(url: URL): number | null {
  const value = url.searchParams.get("target");
  if (value == null || !/^\d+$/.test(value)) return null;
  const ordinal = Number(value);
  return Number.isSafeInteger(ordinal) ? ordinal : null;
}

export interface CalibrationComparisonTargetDetailRouteDependencies {
  loadTargetDetail: typeof loadCalibrationComparisonTargetDetail;
}

export function createCalibrationComparisonTargetDetailHandler(
  dependencies: CalibrationComparisonTargetDetailRouteDependencies = {
    loadTargetDetail: loadCalibrationComparisonTargetDetail,
  },
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const country = countryParameter(url);
    const buildArtifactId = url.searchParams.get("build") ?? "";
    const targetOrdinal = targetOrdinalParameter(url);
    if (!country || !isSha256(buildArtifactId) || targetOrdinal == null) {
      return NextResponse.json(
        { detail: "A valid country, comparison build id, and target ordinal are required." },
        { status: 400 },
      );
    }

    try {
      const detail = await dependencies.loadTargetDetail({
        country,
        buildArtifactId,
        targetOrdinal,
      });
      return NextResponse.json(detail, {
        headers: {
          ...IMMUTABLE_CACHE_HEADERS,
          "X-Calibration-Comparison-Build": buildArtifactId,
        },
      });
    } catch (error) {
      console.error("Calibration comparison target-detail read failed:", error);
      const message = error instanceof Error ? error.message : "";
      const missing = /unavailable|out of range|no summary shard/i.test(message);
      return NextResponse.json(
        {
          detail: missing
            ? "Calibration comparison target detail was not found."
            : "Calibration comparison target detail is unavailable.",
        },
        {
          status: missing ? 404 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  };
}

export const GET = createCalibrationComparisonTargetDetailHandler();
