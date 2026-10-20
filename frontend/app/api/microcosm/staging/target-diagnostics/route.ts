import { NextResponse } from "next/server";

import { hasCapability } from "@policyengine/calibration-tree/countries";
import { parseCountry, scrub } from "@policyengine/calibration-tree/latest-artifact";
import { loadStagingTargetDiagnostics } from "@policyengine/calibration-tree/staging-artifact";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = parseCountry(params.get("country"));
  const runId = params.get("id")?.trim();
  if (!runId && hasCapability(country, "staging")) {
    return NextResponse.json({ detail: "Provide a staging run id via ?id=." }, { status: 400 });
  }
  try {
    return NextResponse.json(
      scrub(
        await loadStagingTargetDiagnostics(request.url, runId ?? "", revalidate, country),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
