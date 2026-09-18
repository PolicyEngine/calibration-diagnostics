import { NextResponse } from "next/server";

import { withBasePath } from "@/lib/base-path";
import { ensureCalibrationComparison } from "@/lib/microcosm/calibration-comparison-blob";
import {
  calibrationComparisonBuildArtifactId,
  calibrationComparisonPairArtifactId,
} from "@/lib/microcosm/calibration-comparison-bundle";
import { getCalibrationTreeBlob } from "@/lib/microcosm/calibration-tree-blob";
import { immutableCalibrationTreePartResponse } from "@/lib/microcosm/calibration-tree-http";
import {
  isCalibrationTreePart,
  isSha256,
  type CalibrationTreePart,
} from "@/lib/microcosm/calibration-tree-artifact";
import {
  isCountry,
  selectableCountries,
  type MicrocosmCountry,
} from "@/lib/microcosm/countries";
import type { TargetChangeMode } from "@/lib/microcosm/target-change";

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

function partParameter(url: URL): CalibrationTreePart | null {
  const value = url.searchParams.get("part");
  return value && isCalibrationTreePart(value) ? value : null;
}

function modeParameter(url: URL): TargetChangeMode | null {
  const value = url.searchParams.get("mode") ?? "reported";
  return value === "reported" || value === "shared" ? value : null;
}

export interface CalibrationComparisonTreeRouteDependencies {
  getBlob: typeof getCalibrationTreeBlob;
  ensureComparison: typeof ensureCalibrationComparison;
}

export function createCalibrationComparisonTreeHandler(
  dependencies: CalibrationComparisonTreeRouteDependencies = {
    getBlob: getCalibrationTreeBlob,
    ensureComparison: ensureCalibrationComparison,
  },
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const country = countryParameter(url);
    const part = partParameter(url);
    const mode = modeParameter(url);
    if (!country || !part || !mode) {
      return NextResponse.json(
        { detail: "A valid country, comparison mode, and tree part are required." },
        { status: 400 },
      );
    }

    let buildArtifactId = url.searchParams.get("build");
    if (!buildArtifactId) {
      const currentBuildArtifactId = url.searchParams.get("a") ?? "";
      const candidateBuildArtifactId = url.searchParams.get("b") ?? "";
      if (
        !isSha256(currentBuildArtifactId) ||
        !isSha256(candidateBuildArtifactId)
      ) {
        return NextResponse.json(
          { detail: "Two exact source build artifact ids are required." },
          { status: 400 },
        );
      }
      const pairArtifactId = calibrationComparisonPairArtifactId(
        country,
        currentBuildArtifactId,
        candidateBuildArtifactId,
      );
      buildArtifactId = calibrationComparisonBuildArtifactId(
        pairArtifactId,
        mode,
      );
      const existing = await dependencies.getBlob({
        country,
        buildArtifactId,
        part: "index",
        consistent: true,
      });
      if (existing?.stream) await existing.stream.cancel();
      if (!existing) {
        const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
        if (!token) {
          return NextResponse.json(
            { detail: "Comparison artifact publication is not configured." },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
        try {
          const built = await dependencies.ensureComparison({
            country,
            currentBuildArtifactId,
            candidateBuildArtifactId,
            token,
          });
          buildArtifactId = mode === "reported"
            ? built.reportedBuildArtifactId
            : built.sharedBuildArtifactId;
        } catch (error) {
          console.error("Calibration comparison publication failed:", error);
          return NextResponse.json(
            {
              detail: error instanceof Error
                ? error.message
                : "Calibration comparison publication failed.",
            },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      }
      const destination = new URL(
        withBasePath("/api/microcosm/comparison-tree"),
        url.origin,
      );
      destination.searchParams.set("country", country);
      destination.searchParams.set("mode", mode);
      destination.searchParams.set("part", part);
      destination.searchParams.set("build", buildArtifactId);
      return new NextResponse(null, {
        status: 307,
        headers: {
          Location: destination.toString(),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Calibration-Comparison-Build": buildArtifactId,
        },
      });
    }

    if (!isSha256(buildArtifactId)) {
      return NextResponse.json(
        { detail: "Invalid comparison build artifact id." },
        { status: 400 },
      );
    }
    try {
      const result = await dependencies.getBlob({
        country,
        buildArtifactId,
        part,
        ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
      });
      if (!result) {
        return NextResponse.json(
          { detail: "Calibration comparison has not been published." },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }
      const headers = {
        ...IMMUTABLE_CACHE_HEADERS,
        ETag: result.blob.etag,
        "X-Calibration-Comparison-Build": buildArtifactId,
      };
      if (result.statusCode === 304) {
        return new NextResponse(null, { status: 304, headers });
      }
      return immutableCalibrationTreePartResponse(request, result, headers);
    } catch (error) {
      console.error("Calibration comparison Blob read failed:", error);
      return NextResponse.json(
        { detail: "Calibration comparison storage is unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const GET = createCalibrationComparisonTreeHandler();
