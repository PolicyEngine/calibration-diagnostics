import { NextResponse } from "next/server";

import { scrub } from "@/lib/populace/latest-artifact";
import { loadStagingRun } from "@/lib/populace/staging-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("id")?.trim();
  if (!runId) {
    return NextResponse.json({ detail: "Provide a staging run id via ?id=." }, { status: 400 });
  }
  try {
    return NextResponse.json(scrub(await loadStagingRun(runId, revalidate)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
