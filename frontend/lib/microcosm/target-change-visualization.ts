import type { CalibrationTreeChangeMetrics } from "./calibration-tree";
import { squarify, type Placed } from "@/lib/treemap/squarify";
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
  return direction === "increase"
    ? metrics.change?.increasedError ?? 0
    : metrics.change?.reducedError ?? 0;
}

export function targetChangeDirectionAreas(
  metrics: CalibrationTreeChangeMetrics | undefined,
  width: number,
  height: number,
): Placed<TargetChangeDirectionData>[] {
  const directions: Array<{ value: number; data: TargetChangeDirectionData }> = [
    {
      value: metrics?.increasedError ?? 0,
      data: { direction: "increase", label: "Increased weighted target error" },
    },
    {
      value: metrics?.reducedError ?? 0,
      data: { direction: "reduction", label: "Reduced weighted target error" },
    },
  ];
  return squarify(
    directions.filter((item) => item.value > 0),
    { x: 0, y: 0, w: Math.max(width, 0), h: Math.max(height, 0) },
  );
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
