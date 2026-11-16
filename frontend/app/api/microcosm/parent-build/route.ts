import { NextResponse } from "next/server";

import { resolveCalibrationRelease } from "@policyengine/calibration-tree/calibration-release-locator";
import { loadCountryRepositoryHashedJson } from "@policyengine/calibration-tree/latest-artifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ParentBuildRouteDependencies {
  resolveRelease: typeof resolveCalibrationRelease;
  loadJson: typeof loadCountryRepositoryHashedJson;
}

export function createParentBuildHandler(
  _dependencies: ParentBuildRouteDependencies = {
    resolveRelease: resolveCalibrationRelease,
    loadJson: loadCountryRepositoryHashedJson,
  },
) {
  return async function GET(_request: Request) {
    return NextResponse.json({ detail: "Not implemented." }, { status: 501 });
  };
}

export const GET = createParentBuildHandler();
