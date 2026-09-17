import { NextResponse } from "next/server";

import { withBasePath } from "@/lib/base-path";
import { getCalibrationTreeBlob } from "@/lib/microcosm/calibration-tree-blob";
import {
  isCalibrationTreePart,
  isHfCommitSha,
  type CalibrationTreePart,
} from "@/lib/microcosm/calibration-tree-artifact";
import { resolveCalibrationRelease } from "@/lib/microcosm/calibration-release-locator";
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

const ALIAS_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "public, max-age=60, stale-if-error=86400",
};

function countryParameter(url: URL): MicrocosmCountry | null {
  const value = url.searchParams.get("country");
  return isCountry(value) && selectableCountries().includes(value) ? value : null;
}

function partParameter(url: URL): CalibrationTreePart | null {
  const value = url.searchParams.get("part");
  return value && isCalibrationTreePart(value) ? value : null;
}

export interface CalibrationTreeRouteDependencies {
  getBlob: typeof getCalibrationTreeBlob;
  resolveRelease: typeof resolveCalibrationRelease;
}

export function createCalibrationTreeHandler(
  dependencies: CalibrationTreeRouteDependencies = {
    getBlob: getCalibrationTreeBlob,
    resolveRelease: resolveCalibrationRelease,
  },
) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const country = countryParameter(url);
    if (!country) {
      return NextResponse.json(
        { detail: "Unknown calibration country." },
        { status: 400 },
      );
    }
    const part = partParameter(url);
    if (!part) {
      return NextResponse.json(
        { detail: "A valid calibration tree part is required." },
        { status: 400 },
      );
    }
    const release = url.searchParams.get("release");
    const revision = url.searchParams.get("revision");
    if (release && revision) {
      return NextResponse.json(
        { detail: "Specify either release or revision, not both." },
        { status: 400 },
      );
    }

    if (!revision) {
      try {
        const location = await dependencies.resolveRelease(
          country,
          release || "latest",
          3600,
        );
        const destination = new URL(
          withBasePath("/api/microcosm/tree"),
          url.origin,
        );
        destination.search = url.search;
        destination.searchParams.delete("release");
        destination.searchParams.set("revision", location.hfCommitSha);
        return new NextResponse(null, {
          status: 307,
          headers: {
            ...ALIAS_CACHE_HEADERS,
            Location: destination.toString(),
            "X-Microcosm-Release": location.releaseId,
            "X-HF-Commit": location.hfCommitSha,
          },
        });
      } catch (error) {
        console.error("Calibration release resolution failed:", error);
        const missing =
          release &&
          release !== "latest" &&
          error instanceof Error &&
          error.message.includes("was not found");
        return NextResponse.json(
          {
            detail: missing
              ? "Calibration release was not found."
              : "Calibration release is unavailable.",
          },
          {
            status: missing ? 404 : 503,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
    }

    if (!isHfCommitSha(revision)) {
      return NextResponse.json(
        { detail: "Invalid Hugging Face commit SHA." },
        { status: 400 },
      );
    }
    try {
      const result = await dependencies.getBlob({
        country,
        hfCommitSha: revision,
        part,
        ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
      });
      if (!result) {
        return NextResponse.json(
          { detail: "Calibration tree has not been published." },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      }
      const headers = {
        ...IMMUTABLE_CACHE_HEADERS,
        ETag: result.blob.etag,
        "X-HF-Commit": revision,
      };
      if (result.statusCode === 304) {
        return new NextResponse(null, { status: 304, headers });
      }
      if (!result.stream) {
        throw new Error("Private Blob response did not contain a stream.");
      }
      return new NextResponse(result.stream, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type":
            result.blob.contentType ?? "application/json; charset=utf-8",
        },
      });
    } catch (error) {
      console.error("Calibration tree Blob read failed:", error);
      return NextResponse.json(
        { detail: "Calibration tree storage is unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

export const GET = createCalibrationTreeHandler();
