import { NextResponse } from "next/server";

import { scrub } from "@/lib/populace/latest-artifact";
import { loadStagingTargetDiagnostics } from "@/lib/populace/staging-artifact";

export const revalidate = 30;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("id")?.trim();
  if (!runId) {
    return NextResponse.json({ detail: "Provide a staging run id via ?id=." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      scrub(await loadStagingTargetDiagnostics(request.url, runId, revalidate)),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
