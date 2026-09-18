import { expect, test } from "bun:test";

import { buildCalibrationTreeBundle } from "./calibration-tree-bundle";
import {
  calibrationTreeTargetsFromSummaries,
  type CalibrationTreeTargetSummaryArtifact,
} from "./calibration-tree-artifact";
import { buildTargetChangeDatasetFromSummaries } from "./calibration-build-comparison";

function comparisonInput(
  buildArtifactId: string,
  releaseId: string,
  contribution: number,
  estimate: number,
) {
  const bundle = buildCalibrationTreeBundle({
    country: "us",
    buildArtifactId,
    releaseId,
    hfRepo: "policyengine/populace-us",
    hfCommitSha: buildArtifactId.slice(0, 40),
    sourceArtifacts: {
      calibrationDiagnostics: {
        path: `releases/${releaseId}/calibration_diagnostics.json`,
        sha256: buildArtifactId,
      },
      buildManifest: null,
      releaseManifest: null,
      demographics: null,
    },
    rows: [{
      name: "snap|national",
      base_name: "snap|national",
      source: "chronicle",
      variable: "snap",
      target_representation: "hierarchy",
      target_dimensions: [],
      target: 100,
      final_estimate: estimate,
      abs_relative_error: Math.abs(estimate / 100 - 1),
      target_loss_weight: 1,
      target_loss_weight_share: 1,
      target_loss_scale: 100,
      final_capped_scaled_error: contribution,
      final_loss_contribution: contribution,
      calibration_status: "included",
    }],
    comparison: {
      releaseId,
      status: "reported",
      aggregate: contribution,
      cap: 1,
      basisIdentifier: "test-basis",
      targetRepresentation: "hierarchy",
    },
  });
  const summaries = bundle.files.flatMap((file) =>
    file.part.startsWith("target-summary-")
      ? [file.artifact as CalibrationTreeTargetSummaryArtifact]
      : [],
  );
  return {
    country: bundle.index.country,
    comparison: bundle.index.targetComparison,
    targets: calibrationTreeTargetsFromSummaries(bundle.index, summaries),
  };
}

test("target summaries contain everything required for a comparison", () => {
  const current = comparisonInput("a".repeat(64), "release-a", 0.1, 110);
  const candidate = comparisonInput("b".repeat(64), "release-b", 0.05, 105);
  const result = buildTargetChangeDatasetFromSummaries(current, candidate);

  expect(result.available).toBe(true);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    comparison_status: "shared",
    comparison_fit: "improved",
    reported_change: -0.05,
  });
  expect(result.summaries.reported?.netChange).toBeCloseTo(-0.05);
});
