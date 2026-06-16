import { NextResponse } from "next/server";

import { loadPointerReleaseId, loadReleases, scrub } from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET() {
  try {
    const [releases, pointer] = await Promise.all([
      loadReleases(revalidate),
      loadPointerReleaseId(revalidate).catch(() => ({ release_id: "", updated_at: null })),
    ]);
    return NextResponse.json(
      scrub({
        latest_release_id: pointer.release_id,
        updated_at: pointer.updated_at,
        // Releases that carry the per-target diagnostics (compare-able).
        releases: releases.filter((r) => r.has_calibration),
        all_releases: releases,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
