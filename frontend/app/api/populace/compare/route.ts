import { NextResponse } from "next/server";

import { loadComparison, loadPointerReleaseId, scrub } from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  let a = url.searchParams.get("a");
  let b = url.searchParams.get("b");
  try {
    // Default b to the latest release; a is required for a real diff.
    if (!b) b = (await loadPointerReleaseId(revalidate)).release_id;
    if (!a || !b) {
      return NextResponse.json(
        { detail: "Provide two releases to compare via ?a=&b=." },
        { status: 400 },
      );
    }
    const comparison = await loadComparison(a, b, revalidate);
    return NextResponse.json(scrub(comparison));
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
