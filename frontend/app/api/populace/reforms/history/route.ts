import { NextResponse } from "next/server";

import { scrub } from "@/lib/populace/latest-artifact";
import { loadReformHistory } from "@/lib/populace/reforms";

export const revalidate = 300;

export async function GET() {
  try {
    const history = await loadReformHistory(revalidate);
    return NextResponse.json(scrub(history));
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
