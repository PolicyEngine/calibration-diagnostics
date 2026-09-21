import { expect, test } from "bun:test";

import type { TargetChangeRow } from "@/lib/microcosm/target-change";
import { stagingTargetDetailPresentation } from "./staging-target-detail-presentation";

const TARGET_CHANGE: TargetChangeRow = {
  name: "benefits",
  base_name: "benefits",
  comparison_id: "benefits",
  match_kind: "base_name",
  current_name: "benefits@2024",
  candidate_name: "benefits@2025",
  current_representation: "legacy",
  candidate_representation: "structured",
  current_target_ordinal: 0,
  candidate_target_ordinal: 0,
  comparison_status: "shared",
  comparison_fit: "improved",
  current: {
    target: 100,
    finalEstimate: 90,
    weight: 1,
    weightShare: 0.4,
    scale: 100,
    cappedError: 0.1,
    contribution: 0.04,
  },
  candidate: {
    target: 100,
    finalEstimate: 95,
    weight: 1,
    weightShare: 0.4,
    scale: 100,
    cappedError: 0.05,
    contribution: 0.02,
  },
  currentDetail: {
    name: "benefits@2024",
    target: 100,
    final_estimate: 90,
    relative_error: -0.1,
    error_kind: "relative",
    calibration_status: "included",
  },
  candidateDetail: {
    name: "benefits@2025",
    target: 100,
    initial_estimate: 80,
    final_estimate: 95,
    initial_relative_error: -0.2,
    relative_error: -0.05,
    error_kind: "relative",
    calibration_status: "included",
  },
  reported_change: -0.02,
  pooled_weight_share: null,
  shared_current_contribution: null,
  shared_candidate_contribution: null,
  shared_change: null,
};

test("builds the staging-only six-metric and shared-target presentation", () => {
  const presentation = stagingTargetDetailPresentation(
    TARGET_CHANGE,
    -0.07,
    TARGET_CHANGE.candidateDetail,
  );

  expect(presentation.metrics.map((metric) => metric.label)).toEqual([
    "Official target",
    "Current release estimate",
    "Candidate estimate",
    "Current release error",
    "Candidate release error",
    "Weighted target error change",
  ]);
  expect(presentation.metrics.map((metric) => metric.value)).toEqual([
    "100",
    "90",
    "95",
    "-10.0%",
    "-5.0%",
    "−7.00 pp",
  ]);
  expect(presentation.afterCalibrationSeries).toEqual([
    {
      label: "Current release after calibration",
      shortLabel: "Current release",
      value: -0.1,
      tone: "primary",
    },
    {
      label: "Candidate after calibration",
      shortLabel: "Candidate",
      value: -0.05,
      tone: "secondary",
    },
  ]);
  expect(presentation.fitSummary).toEqual({
    text: "Candidate dataset decreased absolute error by 5.00 percentage points relative to the current release dataset.",
    tone: "positive",
  });
});

test("omits the unavailable release from added and removed target chart labels", () => {
  const added = stagingTargetDetailPresentation(
    {
      ...TARGET_CHANGE,
      comparison_status: "added",
      match_kind: null,
      current_name: null,
      current_representation: null,
      current: null,
      currentDetail: null,
    },
    -0.07,
    TARGET_CHANGE.candidateDetail,
  );
  expect(added.afterCalibrationSeries.map((series) => series.label)).toEqual([
    "Candidate after calibration",
  ]);
  expect(added.fitSummary).toEqual({
    text: "Candidate contains this target, but the current release does not.",
    tone: "neutral",
  });

  const removed = stagingTargetDetailPresentation(
    {
      ...TARGET_CHANGE,
      comparison_status: "removed",
      match_kind: null,
      candidate_name: null,
      candidate_representation: null,
      candidate: null,
      candidateDetail: null,
    },
    -0.07,
    null,
  );
  expect(removed.afterCalibrationSeries.map((series) => series.label)).toEqual([
    "Current release after calibration",
  ]);
  expect(removed.fitSummary).toEqual({
    text: "Current release contains this target, but the candidate does not.",
    tone: "neutral",
  });
});
