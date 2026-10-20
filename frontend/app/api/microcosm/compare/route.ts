import { NextResponse } from "next/server";

import { requestedCountry } from "@/lib/api/request-country";
import {
  classifyApiError,
  loadComparison,
  loadPointerReleaseId,
  scrub,
} from "@policyengine/calibration-tree/latest-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  let a = url.searchParams.get("a");
  let b = url.searchParams.get("b");
  const country = requestedCountry(url.searchParams);
  if (country instanceof Response) return country;
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
