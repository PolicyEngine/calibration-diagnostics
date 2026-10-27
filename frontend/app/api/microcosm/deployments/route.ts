import { NextResponse } from "next/server";

import { hasCapability, parseCountry } from "@/lib/microcosm/countries";
import { loadDeployments } from "@/lib/microcosm/deployments";

// Lock files and .py tags change at most a few times a day.
export const revalidate = 900;

export async function GET(request: Request) {
  const country = parseCountry(new URL(request.url).searchParams.get("country"));
  if (!hasCapability(country, "deployments")) {
    return NextResponse.json(
      { detail: `No .py bundle tracks a ${country.toUpperCase()} data release.` },
      { status: 404 },
    );
  }
  try {
    return NextResponse.json(await loadDeployments(country, fetch, revalidate));
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
