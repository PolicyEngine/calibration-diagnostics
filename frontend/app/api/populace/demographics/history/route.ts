import { NextResponse } from "next/server";

import { loadDemographicsHistory } from "@/lib/populace/demographics";
import { scrub } from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET() {
  try {
    const history = await loadDemographicsHistory(revalidate);
    return NextResponse.json(scrub(history));
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
