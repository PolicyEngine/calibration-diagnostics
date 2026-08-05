import type { ExplorerState } from "@/lib/microcosm/calibration-explorer";
import type { CalibrationTreeSizeMode } from "@/lib/microcosm/calibration-tree";

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function explorerUpLabel(state: ExplorerState): string | null {
  const dimensions = state.path.dimensions;
  if (dimensions.length) {
    return `Up to ${dimensions.at(-1)?.label ?? humanize(dimensions.at(-1)?.key ?? "breakdown")}`;
  }
  if (state.path.geography) return "Up to all geographies";
  if (state.path.program || state.path.source) return "Up to all programs";
  return null;
}

export function explorerBreadcrumbs(state: ExplorerState): string[] {
  const crumbs: string[] = [];
  if (state.path.source && state.path.program) {
    crumbs.push(humanize(state.path.source));
    crumbs.push(humanize(state.path.program));
  }
  if (state.path.geography) crumbs.push(humanize(state.path.geography));
  crumbs.push(...state.path.dimensions.map((dimension) => humanize(dimension.value)));
  return crumbs;
}

export function hasExplorerFilters(state: ExplorerState): boolean {
  return (
    state.filters.geographyLevels.length > 0 ||
    state.filters.geographies.length > 0 ||
    state.filters.fitBands.length > 0 ||
    state.filters.calibrationStatuses.length > 0
  );
}

export function explorerEmptyMessage(state: ExplorerState): string {
  return hasExplorerFilters(state)
    ? "No calibration targets match the active filters at this level."
    : "No calibration targets match this hierarchy selection in the selected release.";
}

export function explorerSizePhrase(mode: CalibrationTreeSizeMode): string {
  if (mode === "targets") return "how many targets it covers";
  if (mode === "loss") return "its share of the calibration loss";
  return "its Huberized error intensity";
}
