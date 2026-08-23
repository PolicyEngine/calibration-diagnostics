import { NextResponse } from "next/server";

import { ArtifactError } from "@/lib/cross-dataset/artifact";
import { crossDatasetApiResponse } from "@/lib/cross-dataset/query";
import { configuredCrossDatasetReader } from "@/lib/cross-dataset/source";
import { parseCountry } from "@/lib/microcosm/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const country = parseCountry(new URL(request.url).searchParams.get("country"));
  try {
    const response = await crossDatasetApiResponse(
      request.url,
      configuredCrossDatasetReader(country),
    );
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    if (error instanceof ArtifactError) {
      return NextResponse.json(
        { detail: error.message, artifact_error: error.code },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
