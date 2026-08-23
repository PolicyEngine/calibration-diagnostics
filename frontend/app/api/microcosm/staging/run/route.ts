import { NextResponse } from "next/server";

import { parseCountry, scrub } from "@/lib/microcosm/latest-artifact";
import { loadStagingRun } from "@/lib/microcosm/staging-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = parseCountry(params.get("country"));
  const runId = params.get("id")?.trim();
  if (!runId && country === "us") {
    return NextResponse.json({ detail: "Provide a staging run id via ?id=." }, { status: 400 });
  }
  try {
    return NextResponse.json(scrub(await loadStagingRun(runId ?? "", revalidate, country)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
