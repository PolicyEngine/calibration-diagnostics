import { NextResponse } from "next/server";

import {
  latestTargetDiagnosticsPage,
  scrub,
} from "@/lib/microplex/latest-artifact";

export const revalidate = 300;

export async function GET(request: Request) {
  return NextResponse.json(scrub(latestTargetDiagnosticsPage(request.url)));
}
