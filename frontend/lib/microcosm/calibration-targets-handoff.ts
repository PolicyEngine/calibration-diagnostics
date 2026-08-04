import type { ExplorerPath, ExplorerState } from "./calibration-explorer";

export interface ExplorerTargetDiagnosticsParams {
  variable?: string;
  source?: string;
  program?: string;
  facet?: string[];
  geography_level?: string[];
  geography?: string[];
  fit_band?: string[];
  status?: string[];
}

export function explorerVariableKey(path: ExplorerPath): string | undefined {
  if (!path.source || !path.program || !path.measure) return undefined;
  return `${path.source} / ${path.program} · ${path.measure}`;
}

export function targetDiagnosticsParamsFromExplorer(
  state: ExplorerState,
): ExplorerTargetDiagnosticsParams {
  const variable = explorerVariableKey(state.path);
  const facet = state.path.dimensions.map(
    (dimension) => `${dimension.key}:${dimension.value}`,
  );
  return {
    ...(variable ? { variable } : {}),
    ...(!variable && state.path.source && state.path.program
      ? { source: state.path.source, program: state.path.program }
      : {}),
    ...(facet.length ? { facet } : {}),
    ...(state.filters.geographyLevels.length
      ? { geography_level: state.filters.geographyLevels }
      : {}),
    ...(state.filters.geographies.length
      ? { geography: state.filters.geographies }
      : {}),
    ...(state.filters.fitBands.length ? { fit_band: state.filters.fitBands } : {}),
    ...(state.filters.calibrationStatuses.length
      ? { status: state.filters.calibrationStatuses }
      : {}),
  };
}
