import { NextResponse } from "next/server";

import { loadPointerReleaseId, scrub } from "@/lib/populace/latest-artifact";
import { loadStagingComparison } from "@/lib/populace/staging-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("run")?.trim();
  let release = url.searchParams.get("release")?.trim() || "latest";
  if (!runId) {
    return NextResponse.json({ detail: "Provide a staging run id via ?run=." }, { status: 400 });
  }
  try {
    if (release === "latest") {
      release = (await loadPointerReleaseId(300)).release_id;
    }
    return NextResponse.json(scrub(await loadStagingComparison(runId, release, revalidate)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
