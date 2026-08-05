import { NextResponse } from "next/server";

import {
  FIT_BANDS,
  createExplorerState,
  type CalibrationStatus,
  type FitBand,
} from "@/lib/microcosm/calibration-explorer";
import {
  buildCalibrationTree,
  type CalibrationTreeTarget,
} from "@/lib/microcosm/calibration-tree";
import {
  classifyApiError,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/microcosm/latest-artifact";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 300;

const CALIBRATION_STATUSES = new Set<CalibrationStatus>([
  "included",
  "skipped",
  "not_materialized",
]);

function requestState(params: URLSearchParams) {
  const state = createExplorerState();
  const source = params.get("source")?.trim();
  const program = params.get("program")?.trim();
  if (source && program) {
    state.path.source = source;
    state.path.program = program;
    const measure = params.get("measure")?.trim();
    if (measure) {
      state.path.measure = measure;
      for (const [key, value] of params.entries()) {
        if (key.startsWith("dim.") && value.trim()) {
          state.path.dimensions.push({ key: key.slice(4), value: value.trim() });
        }
      }
      state.path.target = params.get("target")?.trim() || undefined;
    }
  }
  state.filters.geographyLevels = params.getAll("geography_level");
  state.filters.geographies = params.getAll("geography");
  state.filters.fitBands = params
    .getAll("fit_band")
    .filter((value): value is FitBand => FIT_BANDS.includes(value as FitBand));
  state.filters.calibrationStatuses = params
    .getAll("status")
    .filter((value): value is CalibrationStatus =>
      CALIBRATION_STATUSES.has(value as CalibrationStatus),
    );
  return state;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    const calibration = await loadRelease(release, revalidate, country);
    const state = requestState(params);
    return NextResponse.json(
      scrub(
        buildCalibrationTree(
          calibration.rows as CalibrationTreeTarget[],
          state,
          calibration.release_id,
        ),
      ),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
