import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import { parseBuildSource } from "@/lib/microcosm/build-source";
import { loadBuildRun } from "@/lib/microcosm/build-runs";
import { InvalidReleaseIdError, scrub } from "@policyengine/calibration-tree/latest-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 120;

// The run detail route, with the loader passed in so tests read no source.
export function createBuildRunHandler(loadRun: typeof loadBuildRun = loadBuildRun) {
  return async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const country = requestedCountry(params);
    if (country instanceof Response) return country;
    const source = parseBuildSource(params.get("source"));
    const runId = params.get("id")?.trim();
    if (!runId) {
      return NextResponse.json({ detail: "Provide a run id via ?id=." }, { status: 400 });
    }
    const notFound = () =>
      NextResponse.json({ detail: `Run ${runId} was not found.` }, { status: 404 });
    try {
      const run = await loadRun(source, country, runId);
      if (!run) return notFound();
      return NextResponse.json(scrub(run), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      // The loader rejects an ID that no source it reads could hold (the
      // Hugging Face history's allowlist is narrower than the collector's,
      // and is checked only when no listed run matched): not found, so the
      // page gives way to its default run, as for any other missing run.
      if (error instanceof InvalidReleaseIdError) return notFound();
      return NextResponse.json(
        { detail: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  };
}

export const GET = createBuildRunHandler();
