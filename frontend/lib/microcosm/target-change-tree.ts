import type { ExplorerState } from "./calibration-explorer";
import {
  buildCalibrationTree,
  type CalibrationTreeResponse,
  type CalibrationTreeTarget,
} from "./calibration-tree";
import {
  targetChangeForMode,
  type TargetChangeAttributionSide,
  type TargetChangeDataset,
  type TargetChangeMethodology,
  type TargetChangeMode,
  type TargetChangeRow,
  type TargetChangeSummary,
} from "./target-change";

export interface TargetChangeTreeResponse extends CalibrationTreeResponse {
  available: boolean;
  reason: string | null;
  mode: TargetChangeMode;
  current: TargetChangeAttributionSide;
  candidate: TargetChangeAttributionSide;
  methodology: TargetChangeMethodology;
  summary: TargetChangeSummary | null;
  selectedTarget: TargetChangeRow | null;
}

export interface TargetChangeTreeUnavailableResponse {
  available: false;
  reason: string;
}

export type TargetChangeTreeApiResponse =
  | TargetChangeTreeResponse
  | TargetChangeTreeUnavailableResponse;

function rowsForMode(
  dataset: TargetChangeDataset,
  mode: TargetChangeMode,
): CalibrationTreeTarget[] {
  return dataset.rows.flatMap((row) => {
    if (mode === "shared" && row.comparison_status !== "shared") return [];
    const change = targetChangeForMode(row, mode);
    return change == null ? [] : [{ ...row, target_change: change }];
  });
}

export function buildTargetChangeTree(
  dataset: TargetChangeDataset,
  state: ExplorerState,
  mode: TargetChangeMode,
): TargetChangeTreeResponse {
  const summary = dataset.summaries[mode];
  const reason = dataset.reason ?? dataset.modeReasons[mode];
  const comparisonRows = summary ? rowsForMode(dataset, mode) : [];
  const tree = buildCalibrationTree(
    comparisonRows,
    state,
    dataset.candidate.releaseId,
    dataset.available,
  );
  const selectedTarget = state.path.target
    ? dataset.rows.find((row) => {
        if (row.name !== state.path.target) return false;
        return mode === "reported" || row.comparison_status === "shared";
      }) ?? null
    : null;
  return {
    ...tree,
    available: dataset.available && summary != null,
    reason,
    mode,
    current: dataset.current,
    candidate: dataset.candidate,
    methodology: dataset.methodology,
    summary,
    selectedTarget,
  };
}
