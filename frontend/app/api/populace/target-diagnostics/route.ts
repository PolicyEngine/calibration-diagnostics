import { NextResponse } from "next/server";

import {
  latestPopulaceTargetDiagnosticsPage,
  scrub,
} from "@/lib/populace/latest-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  return NextResponse.json(scrub(latestPopulaceTargetDiagnosticsPage(request.url)));
}
