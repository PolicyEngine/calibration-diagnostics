import { NextResponse } from "next/server";

import { hfResolveUrl, scrub } from "@/lib/populace/latest-artifact";
import {
  REFORM_VALIDATION_FILE,
  buildReformValidation,
  loadReformValidation,
} from "@/lib/populace/reforms";
import { loadStagingReformValidationRaw } from "@/lib/populace/staging-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  const release = new URL(request.url).searchParams.get("release") ?? "latest";
  try {
    // A candidate staging run reviewed with the same page as a release.
    if (release.startsWith("staging:")) {
      const runId = release.slice("staging:".length);
      const raw = await loadStagingReformValidationRaw(runId, 0);
      if (!raw) {
        return NextResponse.json({
          available: false,
          release_id: release,
          reason: "This staging run has not uploaded reform_validation.json yet.",
          expected_path: `runs/${runId}/${REFORM_VALIDATION_FILE}`,
        });
      }
      return NextResponse.json(scrub(buildReformValidation(raw, release, null)), {
        headers: { "Cache-Control": "no-store" },
      });
    }
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
