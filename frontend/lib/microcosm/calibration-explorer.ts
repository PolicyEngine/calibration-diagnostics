export const FIT_BANDS = [
  "0_5",
  "5_10",
  "10_20",
  "20_40",
  "40_plus",
  "unscored",
] as const;

export type FitBand = (typeof FIT_BANDS)[number];
export type CalibrationStatus = "included" | "skipped" | "not_materialized";

export interface ExplorerDimensionSelection {
  key: string;
  label?: string;
  value: string;
}

export interface ExplorerPath {
  source?: string;
  program?: string;
  measure?: string;
  dimensions: ExplorerDimensionSelection[];
  target?: string;
}

export interface ExplorerFilters {
  geographyLevels: string[];
  geographies: string[];
  fitBands: FitBand[];
  calibrationStatuses: CalibrationStatus[];
}

export interface ExplorerState {
  path: ExplorerPath;
  filters: ExplorerFilters;
}

export type ExplorerNodeSelection =
  | { kind: "program"; source: string; value: string }
  | { kind: "measure"; value: string }
  | { kind: "dimension_value"; key: string; label: string; value: string }
  | { kind: "target"; value: string };

const CALIBRATION_STATUSES = new Set<CalibrationStatus>([
  "included",
  "skipped",
  "not_materialized",
]);
const FIT_BAND_SET = new Set<FitBand>(FIT_BANDS);

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function emptyState(): ExplorerState {
  return {
    path: { dimensions: [] },
    filters: {
      geographyLevels: [],
      geographies: [],
      fitBands: [],
      calibrationStatuses: [],
    },
  };
}

export function parseExplorerSearch(params: URLSearchParams): ExplorerState {
  const next = emptyState();
  const source = params.get("source")?.trim();
  const program = params.get("program")?.trim();

  // The overview presents source and program in one visual level, so neither
  // can form a valid path without the other.
  if (source && program) {
    next.path.source = source;
    next.path.program = program;
    const measure = params.get("measure")?.trim();
    if (measure) {
      next.path.measure = measure;
      for (const [key, value] of params.entries()) {
        if (!key.startsWith("dim.") || !value.trim()) continue;
        next.path.dimensions.push({ key: key.slice(4), value: value.trim() });
      }
      const target = params.get("target")?.trim();
      if (target) next.path.target = target;
    }
  }

  next.filters.geographyLevels = unique(params.getAll("geography_level"));
  next.filters.geographies = unique(params.getAll("geography"));
  next.filters.fitBands = unique(params.getAll("fit_band")).filter(
    (value): value is FitBand => FIT_BAND_SET.has(value as FitBand),
  );
  next.filters.calibrationStatuses = unique(params.getAll("status")).filter(
    (value): value is CalibrationStatus =>
      CALIBRATION_STATUSES.has(value as CalibrationStatus),
  );
  return next;
}

export function serializeExplorerSearch(
  state: ExplorerState,
  existing: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams(existing);
  for (const key of [...next.keys()]) {
    if (
      key === "source" ||
      key === "program" ||
      key === "measure" ||
      key === "target" ||
      key === "geography_level" ||
      key === "geography" ||
      key === "fit_band" ||
      key === "status" ||
      key === "drill" ||
      key.startsWith("dim.")
    ) {
      next.delete(key);
    }
  }

  if (state.path.source && state.path.program) {
    next.set("source", state.path.source);
    next.set("program", state.path.program);
    if (state.path.measure) {
      next.set("measure", state.path.measure);
      for (const dimension of state.path.dimensions) {
        next.set(`dim.${dimension.key}`, dimension.value);
      }
      if (state.path.target) next.set("target", state.path.target);
    }
  }
  for (const value of state.filters.geographyLevels) {
    next.append("geography_level", value);
  }
  for (const value of state.filters.geographies) next.append("geography", value);
  for (const value of state.filters.fitBands) next.append("fit_band", value);
  for (const value of state.filters.calibrationStatuses) next.append("status", value);
  return next;
}

export function selectExplorerNode(
  state: ExplorerState,
  selection: ExplorerNodeSelection,
): ExplorerState {
  const path = { ...state.path, dimensions: [...state.path.dimensions] };
  delete path.target;
  if (selection.kind === "program") {
    path.source = selection.source;
    path.program = selection.value;
    delete path.measure;
    path.dimensions = [];
  } else if (selection.kind === "measure") {
    if (!path.source || !path.program) return state;
    path.measure = selection.value;
    path.dimensions = [];
  } else if (selection.kind === "dimension_value") {
    if (!path.measure) return state;
    path.dimensions = [
      ...path.dimensions.filter((dimension) => dimension.key !== selection.key),
      {
        key: selection.key,
        label: selection.label,
        value: selection.value,
      },
    ];
  } else {
    if (!path.measure) return state;
    path.target = selection.value;
  }
  return { ...state, path };
}

export function parentExplorerState(state: ExplorerState): ExplorerState {
  const path = { ...state.path, dimensions: [...state.path.dimensions] };
  delete path.target;
  if (path.dimensions.length) {
    path.dimensions.pop();
  } else if (path.measure) {
    delete path.measure;
  } else if (path.program || path.source) {
    delete path.program;
    delete path.source;
  }
  return { ...state, path };
}
