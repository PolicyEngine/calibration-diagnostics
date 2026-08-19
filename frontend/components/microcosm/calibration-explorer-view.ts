import type {
  ExplorerPath,
  ExplorerState,
} from "@/lib/microcosm/calibration-explorer";
import {
  type CalibrationTreeMetrics,
  type CalibrationTreeNode,
  type CalibrationTreeSizeMode,
} from "@/lib/microcosm/calibration-tree";
import { canonicalLabel, programLabel } from "@/lib/microcosm/program-label";
import { sourceLabel } from "@/lib/microcosm/source-label";

export const EXPLORER_MAP_VERTICAL_PADDING = 10;

export const WEIGHTED_TARGET_ERROR_HELP =
  "Weighted target error is the final calibration loss: the importance-weighted mean of each target's scaled error after applying the loss cap. In this view, box area shows how much each target or group contributes to that total.";

export const WEIGHTED_MEAN_ERROR_HELP =
  "Weighted mean error is the arithmetic mean of the capped, scaled target errors in a box, weighted by each target's calibration importance. Redder boxes therefore contain more severe errors after more important targets are given greater influence.";

function humanize(value: string): string {
  const acronyms = new Set(["agi", "ctc", "eitc", "irs", "jct", "ssi"]);
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w+/g, (word) =>
      acronyms.has(word.toLowerCase())
        ? word.toUpperCase()
        : word[0].toUpperCase() + word.slice(1),
    );
}

function geographyLabel(value: string): string {
  return humanize(value);
}

export function explorerUpLabel(state: ExplorerState): string | null {
  const dimensions = state.path.dimensions;
  if (dimensions.length) {
    return `Up to ${dimensions.at(-1)?.label ?? humanize(dimensions.at(-1)?.key ?? "breakdown")}`;
  }
  if (state.path.geography && state.path.source && state.path.program) {
    return state.breakdown === "program"
      ? "Up to all geographies"
      : "Up to all programs";
  }
  if (state.path.geography) return "Up to all geographies";
  if (state.path.program || state.path.source) return "Up to all programs";
  return null;
}

export interface ExplorerBreadcrumb {
  label: string;
  path: ExplorerPath;
}

export function explorerBreadcrumbs(state: ExplorerState): ExplorerBreadcrumb[] {
  const crumbs: ExplorerBreadcrumb[] = [
    { label: "All targets", path: { dimensions: [] } },
  ];
  if (state.breakdown === "geography" && state.path.geography) {
    crumbs.push({
      label: geographyLabel(state.path.geography),
      path: { geography: state.path.geography, dimensions: [] },
    });
  }
  if (state.path.source && state.path.program) {
    crumbs.push({
      label: sourceLabel(state.path.source),
      path:
        state.breakdown === "geography" && state.path.geography
          ? { geography: state.path.geography, dimensions: [] }
          : { dimensions: [] },
    });
    crumbs.push({
      label: programLabel(state.path.program),
      path: {
        source: state.path.source,
        program: state.path.program,
        ...(state.breakdown === "geography" && state.path.geography
          ? { geography: state.path.geography }
          : {}),
        dimensions: [],
      },
    });
  }
  if (
    state.breakdown === "program" &&
    state.path.source &&
    state.path.program &&
    state.path.geography
  ) {
    crumbs.push({
      label: geographyLabel(state.path.geography),
      path: {
        source: state.path.source,
        program: state.path.program,
        geography: state.path.geography,
        dimensions: [],
      },
    });
  }
  if (state.path.source && state.path.program) {
    state.path.dimensions.forEach((dimension, index) => {
      crumbs.push({
        label: canonicalLabel(dimension.value),
        path: {
          source: state.path.source,
          program: state.path.program,
          ...(state.path.geography
            ? { geography: state.path.geography }
            : {}),
          dimensions: state.path.dimensions.slice(0, index + 1),
        },
      });
    });
  }
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

export function explorerGeographyLevelLabel(value: string): string {
  if (value === "national") return "National";
  if (value === "state") return "State";
  return humanize(value);
}

export function explorerSizePhrase(mode: CalibrationTreeSizeMode): string {
  if (mode === "targets") return "how many targets it covers";
  if (mode === "weight") return "its share of total target weight";
  if (mode === "loss") return "its share of weighted target error";
  return "its selected metric";
}

export function explorerColorMetric(
  mode: CalibrationTreeSizeMode,
  metrics: Pick<
    CalibrationTreeMetrics,
    "medianAbsRelativeError" | "weightedAverageCappedError"
  >,
): number | null {
  return mode === "loss" || mode === "weight"
    ? metrics.weightedAverageCappedError
    : metrics.medianAbsRelativeError;
}

export function explorerColorLegendLabel(mode: CalibrationTreeSizeMode): string {
  return mode === "loss" || mode === "weight" ? "Weighted mean error" : "Median error";
}

export function explorerColorPhrase(mode: CalibrationTreeSizeMode): string {
  return mode === "loss" || mode === "weight"
    ? "the importance-weighted mean error within each box, after target scaling and the loss cap"
    : "the median gap between the weighted data and the official figure";
}

export function explorerLossAvailabilityMessage(available: boolean): string | null {
  return available
    ? null
    : "Target weight and weighted target error are unavailable for this release.";
}

export function explorerMapHeight(pageIntroHeight: number): string {
  const safePageIntroHeight = Number.isFinite(pageIntroHeight)
    ? Math.max(Math.round(pageIntroHeight), 0)
    : 0;
  return `max(0px, calc(100dvh - var(--site-header-height) - ${safePageIntroHeight}px))`;
}

export function explorerNodeLabel(
  node: Pick<CalibrationTreeNode, "id" | "kind" | "label">,
): string {
  if (node.kind === "program") return programLabel(node.id);
  if (node.kind === "dimension_value") return canonicalLabel(node.label);
  return node.label;
}
