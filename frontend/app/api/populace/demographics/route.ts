import { NextResponse } from "next/server";

import { hfResolveUrl, scrub } from "@/lib/populace/latest-artifact";
import { DEMOGRAPHICS_FILE, loadDemographics } from "@/lib/populace/demographics";

export const revalidate = 300;

export async function GET(request: Request) {
  const release = new URL(request.url).searchParams.get("release") ?? "latest";
  try {
    const demographics = await loadDemographics(release, revalidate);
    if (!demographics.available) {
      return NextResponse.json(demographics);
    }
    const prefix = `releases/${demographics.release_id}`;
    return NextResponse.json(
      scrub({
        ...demographics,
        source_artifact: {
          name: "demographics",
          path: `${prefix}/${DEMOGRAPHICS_FILE}`,
          url: hfResolveUrl(`${prefix}/${DEMOGRAPHICS_FILE}`),
        },
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
