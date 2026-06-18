import { NextResponse } from "next/server";

import { hfResolveUrl, scrub } from "@/lib/populace/latest-artifact";
import { REFORM_VALIDATION_FILE, loadReformValidation } from "@/lib/populace/reforms";

export const revalidate = 300;

export async function GET(request: Request) {
  const release = new URL(request.url).searchParams.get("release") ?? "latest";
  try {
    const validation = await loadReformValidation(release, revalidate);
    if (!validation.available) {
      // Expected when a release predates the producer artifact — 200 with a
      // clear "not published" payload so the view shows an empty state, not an
      // error.
      return NextResponse.json(validation);
    }
    const prefix = `releases/${validation.release_id}`;
    return NextResponse.json(
      scrub({
        ...validation,
        source_artifact: {
          name: "reform_validation",
          path: `${prefix}/${REFORM_VALIDATION_FILE}`,
          url: hfResolveUrl(`${prefix}/${REFORM_VALIDATION_FILE}`),
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
