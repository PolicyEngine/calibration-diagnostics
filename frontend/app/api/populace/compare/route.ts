import { NextResponse } from "next/server";

import {
  classifyApiError,
  loadComparison,
  loadPointerReleaseId,
  parseCountry,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  let a = url.searchParams.get("a");
  let b = url.searchParams.get("b");
  const country = parseCountry(url.searchParams.get("country"));
  try {
    // Default b to the latest release; a is required for a real diff.
    if (!b) b = (await loadPointerReleaseId(revalidate, country)).release_id;
    if (!a || !b) {
      return NextResponse.json(
        { detail: "Provide two releases to compare via ?a=&b=." },
        { status: 400 },
      );
    }
    const comparison = await loadComparison(a, b, revalidate, country);
    return NextResponse.json(scrub(comparison));
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
