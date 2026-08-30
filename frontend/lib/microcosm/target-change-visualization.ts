import type { Placed } from "@/lib/treemap/squarify";
import type {
  CalibrationTreeChangeMetrics,
  CalibrationTreeGroup,
} from "./calibration-tree";
import { aggregateCalibrationTreeMetrics } from "./calibration-treemap-layout";
import type {
  TargetChangeMode,
  TargetChangeRow,
} from "./target-change";

export type TargetChangeDirection = "increase" | "reduction";

export function targetChangeMapIdentity(runId: string, releaseId: string): string {
  return `${runId}:${releaseId}`;
}

export interface TargetChangeDirectionData {
  direction: TargetChangeDirection;
  label: string;
}

export function targetChangeDirectionValue(
  metrics: { change?: CalibrationTreeChangeMetrics },
  direction: TargetChangeDirection,
): number {
  const netChange = metrics.change?.netChange ?? 0;
  if (Math.abs(netChange) <= 1e-12) return 0;
  return direction === "increase"
    ? Math.max(netChange, 0)
    : Math.max(-netChange, 0);
}

/**
 * Retains only categories whose net change belongs to the requested direction.
 * A source group may be present in both results, but each category node is
 * present in no more than one result.
 */
export function targetChangeGroupsForDirection(
  groups: CalibrationTreeGroup[],
  direction: TargetChangeDirection,
): CalibrationTreeGroup[] {
  return groups.flatMap((group) => {
    const nodes = group.nodes.filter(
      (node) => targetChangeDirectionValue(node.metrics, direction) > 0,
    );
    if (!nodes.length) return [];
    return [{
      ...group,
      nodes,
      metrics: aggregateCalibrationTreeMetrics(nodes),
    }];
  });
}

export function targetChangeDirectionTotals(
  groups: CalibrationTreeGroup[],
): Record<TargetChangeDirection, number> {
  return groups.reduce(
    (totals, group) => {
      for (const node of group.nodes) {
        totals.increase += targetChangeDirectionValue(node.metrics, "increase");
        totals.reduction += targetChangeDirectionValue(node.metrics, "reduction");
      }
      return totals;
    },
    { increase: 0, reduction: 0 },
  );
}

export function targetChangeDirectionAreas(
  groups: CalibrationTreeGroup[],
  width: number,
  height: number,
): Placed<TargetChangeDirectionData>[] {
  const totals = targetChangeDirectionTotals(groups);
  const safeWidth = Math.max(width, 0);
  const safeHeight = Math.max(height, 0);
  const total = totals.increase + totals.reduction;
  if (total <= 0 || safeWidth <= 0 || safeHeight <= 0) return [];

  if (totals.increase <= 0) {
    return [{
      x: 0,
      y: 0,
      w: safeWidth,
      h: safeHeight,
      value: totals.reduction,
      data: { direction: "reduction", label: "Reduced weighted target error" },
    }];
  }
  if (totals.reduction <= 0) {
    return [{
      x: 0,
      y: 0,
      w: safeWidth,
      h: safeHeight,
      value: totals.increase,
      data: { direction: "increase", label: "Increased weighted target error" },
    }];
  }

  const increaseWidth = safeWidth * (totals.increase / total);
  return [
    {
      x: 0,
      y: 0,
      w: increaseWidth,
      h: safeHeight,
      value: totals.increase,
      data: { direction: "increase", label: "Increased weighted target error" },
    },
    {
      x: increaseWidth,
      y: 0,
      w: safeWidth - increaseWidth,
      h: safeHeight,
      value: totals.reduction,
      data: { direction: "reduction", label: "Reduced weighted target error" },
    },
  ];
}

export function formatWeightedTargetError(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatTargetChange(
  value: number | null | undefined,
  alwaysSign = true,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const percentagePoints = value * 100;
  const sign = percentagePoints > 0
    ? "+"
    : percentagePoints < 0
      ? "−"
      : alwaysSign
        ? "±"
        : "";
  return `${sign}${Math.abs(percentagePoints).toFixed(2)} pp`;
}

export interface TargetChangeDetailValues {
  currentWeightShare: number | null;
  candidateWeightShare: number | null;
  comparisonWeight: number | null;
  currentContribution: number | null;
  candidateContribution: number | null;
  change: number | null;
}

export function targetChangeDetailValues(
  target: TargetChangeRow,
  mode: TargetChangeMode,
): TargetChangeDetailValues {
  return {
    currentWeightShare: target.current?.weightShare ?? null,
    candidateWeightShare: target.candidate?.weightShare ?? null,
    comparisonWeight: mode === "shared" ? target.pooled_weight_share : null,
    currentContribution: mode === "reported"
      ? target.current?.contribution ?? null
      : target.shared_current_contribution,
    candidateContribution: mode === "reported"
      ? target.candidate?.contribution ?? null
      : target.shared_candidate_contribution,
    change: mode === "reported" ? target.reported_change : target.shared_change,
  };
}
