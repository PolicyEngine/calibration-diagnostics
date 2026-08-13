import { NextResponse } from "next/server";

import { ArtifactError } from "@/lib/cross-dataset/artifact";
import { crossDatasetApiResponse } from "@/lib/cross-dataset/query";
import { configuredCrossDatasetReader } from "@/lib/cross-dataset/source";

export const revalidate = 300;
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const response = await crossDatasetApiResponse(
      request.url,
      configuredCrossDatasetReader(),
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
