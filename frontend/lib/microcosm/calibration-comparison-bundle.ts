import { createHash } from "node:crypto";

import { buildTargetChangeDatasetFromIndexes } from "./calibration-build-comparison";
import type {
  CalibrationTreeIndexArtifact,
  CalibrationTreeTargetIndexArtifact,
} from "./calibration-tree-artifact";
import type { CalibrationTreeTarget } from "./calibration-tree";
import {
  buildCalibrationTreeBundle,
  type CalibrationTreeBundle,
} from "./calibration-tree-bundle";
import { targetChangeForMode, type TargetChangeMode } from "./target-change";

export interface ComparisonBundleSource {
  index: CalibrationTreeIndexArtifact;
  targetIndex: CalibrationTreeTargetIndexArtifact;
}

export interface CalibrationComparisonBundles {
  pairArtifactId: string;
  reported: CalibrationTreeBundle;
  shared: CalibrationTreeBundle;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function calibrationComparisonPairArtifactId(
  country: string,
  currentBuildArtifactId: string,
  candidateBuildArtifactId: string,
): string {
  return sha256(JSON.stringify({
    schemaVersion: 4,
    country,
    currentBuildArtifactId,
    candidateBuildArtifactId,
  }));
}

export function calibrationComparisonBuildArtifactId(
  pairArtifactId: string,
  mode: TargetChangeMode,
): string {
  return sha256(JSON.stringify({
    schemaVersion: 4,
    pairArtifactId,
    mode,
  }));
}

function rowsForMode(
  rows: ReturnType<typeof buildTargetChangeDatasetFromIndexes>["rows"],
  mode: TargetChangeMode,
): CalibrationTreeTarget[] {
  return rows.flatMap((row) => {
    if (mode === "shared" && row.comparison_status !== "shared") return [];
    const change = targetChangeForMode(row, mode);
    return change == null ? [] : [{ ...row, target_change: change }];
  });
}

export function buildCalibrationComparisonBundles(
  current: ComparisonBundleSource,
  candidate: ComparisonBundleSource,
): CalibrationComparisonBundles {
  if (current.index.country !== candidate.index.country) {
    throw new Error("Calibration builds from different countries cannot be compared.");
  }
  if (
    current.index.buildArtifactId !== current.targetIndex.buildArtifactId ||
    candidate.index.buildArtifactId !== candidate.targetIndex.buildArtifactId
  ) {
    throw new Error("Calibration comparison source parts have inconsistent identities.");
  }
  const country = current.index.country;
  const currentBuildArtifactId = current.index.buildArtifactId;
  const candidateBuildArtifactId = candidate.index.buildArtifactId;
  const pairArtifactId = calibrationComparisonPairArtifactId(
    country,
    currentBuildArtifactId,
    candidateBuildArtifactId,
  );
  const dataset = buildTargetChangeDatasetFromIndexes(
    current.targetIndex,
    candidate.targetIndex,
  );
  const buildForMode = (mode: TargetChangeMode): CalibrationTreeBundle => {
    const buildArtifactId = calibrationComparisonBuildArtifactId(
      pairArtifactId,
      mode,
    );
    return buildCalibrationTreeBundle({
      country,
      buildArtifactId,
      buildKind: "comparison",
      sourceId: `${currentBuildArtifactId}:${candidateBuildArtifactId}:${mode}`,
      label: `${dataset.current.releaseId} → ${dataset.candidate.releaseId}`,
      createdAt: candidate.index.build.createdAt,
      releaseId: dataset.candidate.releaseId,
      hfRepo: null,
      hfCommitSha: null,
      sourceArtifacts: {
        calibrationDiagnostics: null,
        buildManifest: null,
        releaseManifest: null,
        demographics: null,
        comparisonCurrentTargetIndex: {
          path: current.index.parts.targetIndex.path,
          sha256: current.index.parts.targetIndex.sha256,
        },
        comparisonCandidateTargetIndex: {
          path: candidate.index.parts.targetIndex.path,
          sha256: candidate.index.parts.targetIndex.sha256,
        },
      },
      rows: rowsForMode(dataset.rows, mode),
      calibrationProvenance: dataset.candidate.calibrationProvenance,
      lossAttributionAvailable: dataset.available,
      comparison: candidate.targetIndex.comparison,
      comparisonResult: {
        pairArtifactId,
        currentBuildArtifactId,
        candidateBuildArtifactId,
        mode,
        available: dataset.available && dataset.summaries[mode] != null,
        reason: dataset.reason ?? dataset.modeReasons[mode],
        current: dataset.current,
        candidate: dataset.candidate,
        methodology: dataset.methodology,
        matching: dataset.matching,
        summary: dataset.summaries[mode],
      },
    });
  };

  return {
    pairArtifactId,
    reported: buildForMode("reported"),
    shared: buildForMode("shared"),
  };
}
