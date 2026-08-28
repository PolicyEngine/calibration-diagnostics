import {
  FIT_BANDS,
  createExplorerState,
  type CalibrationStatus,
  type FitBand,
} from "./calibration-explorer";

const CALIBRATION_STATUSES = new Set<CalibrationStatus>([
  "included",
  "skipped",
]);

export function calibrationTreeRequestState(params: URLSearchParams) {
  const state = createExplorerState();
  state.breakdown = params.get("breakdown") === "geography" ? "geography" : "program";
  const source = params.get("source")?.trim();
  const program = params.get("program")?.trim();
  const geography = params.get("path_geography")?.trim();
  if (geography) state.path.geography = geography;
  if (source && program) {
    state.path.source = source;
    state.path.program = program;
    for (const [key, value] of params.entries()) {
      if (key.startsWith("dim.") && value.trim()) {
        state.path.dimensions.push({ key: key.slice(4), value: value.trim() });
      }
    }
    state.path.target = params.get("target")?.trim() || undefined;
  }
  state.filters.geographyLevels = params.getAll("geography_level");
  state.filters.geographies = params.getAll("geography");
  state.filters.fitBands = params
    .getAll("fit_band")
    .filter((value): value is FitBand => FIT_BANDS.includes(value as FitBand));
  state.filters.calibrationStatuses = params
    .getAll("status")
    .map((value) => (value === "not_materialized" ? "skipped" : value))
    .filter((value): value is CalibrationStatus =>
      CALIBRATION_STATUSES.has(value as CalibrationStatus),
    );
  return state;
}
