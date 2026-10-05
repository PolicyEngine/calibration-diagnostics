import { NextResponse } from "next/server";

import { loadBuildRun } from "@/lib/microcosm/build-runs";
import { parseCountry, scrub } from "@/lib/microcosm/latest-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = parseCountry(params.get("country"));
  const runId = params.get("id")?.trim();
  if (!runId) {
    return NextResponse.json({ detail: "Provide a run id via ?id=." }, { status: 400 });
  }
  try {
    const run = await loadBuildRun(country, runId);
    if (!run) {
      return NextResponse.json({ detail: `Run ${runId} was not found.` }, { status: 404 });
    }
    return NextResponse.json(scrub(run), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
