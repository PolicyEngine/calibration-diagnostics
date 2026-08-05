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
  geography?: string;
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
  | { kind: "geography"; value: string }
  | { kind: "dimension_value"; key: string; label: string; value: string }
  | { kind: "target"; value: string };

export type ExplorerAction =
  | { type: "select"; selection: ExplorerNodeSelection }
  | { type: "up" }
  | { type: "filters"; filters: ExplorerFilters }
  | { type: "clear_target" };

export function createExplorerState(): ExplorerState {
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

export function selectExplorerNode(
  state: ExplorerState,
  selection: ExplorerNodeSelection,
): ExplorerState {
  const path = { ...state.path, dimensions: [...state.path.dimensions] };
  delete path.target;
  if (selection.kind === "program") {
    path.source = selection.source;
    path.program = selection.value;
    delete path.geography;
    path.dimensions = [];
  } else if (selection.kind === "geography") {
    if (!path.source || !path.program) return state;
    path.geography = selection.value;
    path.dimensions = [];
  } else if (selection.kind === "dimension_value") {
    if (!path.geography) return state;
    path.dimensions = [
      ...path.dimensions.filter((dimension) => dimension.key !== selection.key),
      {
        key: selection.key,
        label: selection.label,
        value: selection.value,
      },
    ];
  } else {
    if (!path.geography) return state;
    path.target = selection.value;
  }
  return { ...state, path };
}

export function parentExplorerState(state: ExplorerState): ExplorerState {
  const path = { ...state.path, dimensions: [...state.path.dimensions] };
  delete path.target;
  if (path.dimensions.length) {
    path.dimensions.pop();
  } else if (path.geography) {
    delete path.geography;
  } else if (path.program || path.source) {
    delete path.program;
    delete path.source;
  }
  return { ...state, path };
}

export function explorerReducer(
  state: ExplorerState,
  action: ExplorerAction,
): ExplorerState {
  if (action.type === "select") {
    return selectExplorerNode(state, action.selection);
  }
  if (action.type === "up") return parentExplorerState(state);
  if (action.type === "filters") {
    return {
      ...state,
      filters: action.filters,
      path: { ...state.path, dimensions: [...state.path.dimensions], target: undefined },
    };
  }
  return {
    ...state,
    path: { ...state.path, dimensions: [...state.path.dimensions], target: undefined },
  };
}
