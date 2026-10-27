import {
  targetErrorText,
  targetEstimateText,
  type MicrocosmTargetDetailMetric,
  type MicrocosmTargetErrorSeries,
  type MicrocosmTargetErrorSummary,
} from "@/components/microcosm/microcosm-target-detail";
import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";
import type { TargetChangeRow } from "@policyengine/calibration-tree/target-change";
import {
  formatTargetChange,
  sentenceCaseToPhrase,
} from "@/lib/microcosm/target-change-visualization";

export interface StagingTargetDetailPresentation {
  /** Which side the shown detail row comes from. */
  eyebrow: string;
  metrics: MicrocosmTargetDetailMetric[];
  afterCalibrationSeries: MicrocosmTargetErrorSeries[];
  fitSummary: MicrocosmTargetErrorSummary | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function targetError(row: MicrocosmTargetRow | null): {
  kind: "relative" | "absolute";
  value: number | null;
} {
  const target = finiteNumber(row?.target);
  const kind = row?.error_kind ?? (target === 0 ? "absolute" : "relative");
  if (!row) return { kind, value: null };
  if (kind === "absolute") {
    return {
      kind,
      value: finiteNumber(row.final_miss) ?? finiteNumber(row.final_error),
    };
  }
  return {
    kind,
    value: finiteNumber(row.relative_error) ?? finiteNumber(row.final_error),
  };
}

function errorTone(
  kind: "relative" | "absolute",
  value: number | null,
): MicrocosmTargetDetailMetric["tone"] {
  if (kind === "absolute" || value == null) return "neutral";
  return Math.abs(value) <= 0.1 ? "positive" : "negative";
}

function rowFromDetail(
  row: TargetChangeRow["currentDetail"] | TargetChangeRow["candidateDetail"],
): MicrocosmTargetRow | null {
  return row as MicrocosmTargetRow | null;
}

function candidateComparisonSummary(
  currentError: ReturnType<typeof targetError>,
  candidateError: ReturnType<typeof targetError>,
  comparisonReleasePhrase: string,
): MicrocosmTargetErrorSummary | null {
  if (
    currentError.kind !== candidateError.kind ||
    currentError.value == null ||
    candidateError.value == null
  ) {
    return null;
  }
  const change = Math.abs(candidateError.value) - Math.abs(currentError.value);
  if (Math.abs(change) < 0.00005) {
    return {
      text: `Candidate dataset left absolute error unchanged relative to the ${comparisonReleasePhrase} dataset.`,
      tone: "neutral",
    };
  }
  const amount =
    currentError.kind === "absolute"
      ? targetErrorText("absolute", Math.abs(change))
      : `${(Math.abs(change) * 100).toFixed(Math.abs(change) >= 0.1 ? 1 : 2)} percentage points`;
  const increased = change > 0;
  return {
    text: `Candidate dataset ${increased ? "increased" : "decreased"} absolute error by ${amount} relative to the ${comparisonReleasePhrase} dataset.`,
    tone: increased ? "negative" : "positive",
  };
}

/**
 * The staging target detail's metrics, chart series and summary.
 * `comparisonReleaseLabel` names the release the candidate is compared with,
 * such as "Local-area release" for a UK local-area candidate.
 */
export function stagingTargetDetailPresentation(
  targetChange: TargetChangeRow | null,
  weightedTargetErrorChange: number | null,
  candidateFallback: MicrocosmTargetRow | null,
  comparisonReleaseLabel = "Current release",
): StagingTargetDetailPresentation {
  const comparisonReleasePhrase = sentenceCaseToPhrase(comparisonReleaseLabel);
  const currentRow = rowFromDetail(targetChange?.currentDetail ?? null);
  const candidateRow = rowFromDetail(targetChange?.candidateDetail ?? null) ?? candidateFallback;
  const currentError = targetError(currentRow);
  const candidateError = targetError(candidateRow);
  const unit =
    candidateRow?.chronicle?.measure_unit?.toUpperCase() ??
    currentRow?.chronicle?.measure_unit?.toUpperCase();
  const officialTarget =
    targetChange?.candidate?.target ??
    finiteNumber(candidateRow?.target) ??
    targetChange?.current?.target ??
    finiteNumber(currentRow?.target);
  const currentEstimate =
    targetChange?.current?.finalEstimate ?? finiteNumber(currentRow?.final_estimate);
  const candidateEstimate =
    targetChange?.candidate?.finalEstimate ?? finiteNumber(candidateRow?.final_estimate);
  const afterCalibrationSeries: MicrocosmTargetErrorSeries[] = [];
  if (currentRow) {
    afterCalibrationSeries.push({
      label: `${comparisonReleaseLabel} after calibration`,
      shortLabel: comparisonReleaseLabel,
      value: currentError.value,
      tone: "primary",
    });
  }
  if (candidateRow) {
    afterCalibrationSeries.push({
      label: "Candidate after calibration",
      shortLabel: "Candidate",
      value: candidateError.value,
      tone: "secondary",
    });
  }

  return {
    eyebrow: targetChange?.candidateDetail
      ? "Candidate calibration target"
      : `${comparisonReleaseLabel} calibration target`,
    metrics: [
      {
        label: "Official target",
        value: targetEstimateText(officialTarget),
        caption: unit,
      },
      {
        label: `${comparisonReleaseLabel} estimate`,
        value: targetEstimateText(currentEstimate),
        caption: unit,
      },
      {
        label: "Candidate estimate",
        value: targetEstimateText(candidateEstimate),
        caption: unit,
      },
      {
        label: `${comparisonReleaseLabel} error`,
        value: targetErrorText(currentError.kind, currentError.value, true),
        caption: currentError.kind === "absolute" ? "Absolute difference" : "Relative to target",
        tone: errorTone(currentError.kind, currentError.value),
      },
      {
        label: "Candidate release error",
        value: targetErrorText(candidateError.kind, candidateError.value, true),
        caption: candidateError.kind === "absolute" ? "Absolute difference" : "Relative to target",
        tone: errorTone(candidateError.kind, candidateError.value),
      },
      {
        label: "Weighted target error change",
        value: formatTargetChange(weightedTargetErrorChange),
        caption: `Candidate dataset minus ${comparisonReleasePhrase}`,
        tone:
          weightedTargetErrorChange == null || weightedTargetErrorChange === 0
            ? "neutral"
            : weightedTargetErrorChange < 0
              ? "positive"
              : "negative",
      },
    ],
    afterCalibrationSeries,
    fitSummary: currentRow && candidateRow
      ? candidateComparisonSummary(currentError, candidateError, comparisonReleasePhrase)
      : candidateRow
        ? {
            text: `Candidate contains this target, but the ${comparisonReleasePhrase} does not.`,
            tone: "neutral",
          }
        : currentRow
          ? {
              text: `${comparisonReleaseLabel} contains this target, but the candidate does not.`,
              tone: "neutral",
            }
          : null,
  };
}
