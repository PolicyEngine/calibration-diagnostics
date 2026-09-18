import type { Calibration } from "./latest-artifact";
import type { CalibrationTreeTargetIndexArtifact } from "./calibration-tree-artifact";
import { buildTargetChangeDataset, type TargetChangeDataset } from "./target-change";

function calibrationFromTargetIndex(
  index: CalibrationTreeTargetIndexArtifact,
): Calibration {
  const comparison = index.comparison;
  return {
    release_id: comparison.releaseId,
    calibration_provenance: comparison.calibrationProvenance ?? {
      mode: "direct",
      dataset_release_id: comparison.releaseId,
      calibration_source_id: comparison.releaseId,
      diagnostics_sha256: null,
      target_surface_sha256: null,
      validation: { status: "not_applicable", reason: null },
    },
    target_schema: {
      diagnostics_schema_version: null,
      structured_dimensions:
        comparison.targetRepresentation === "structured" ||
        comparison.targetRepresentation === "hierarchy" ||
        comparison.targetRepresentation === "mixed",
      target_representation: comparison.targetRepresentation,
    },
    target_loss_attribution: {
      status: comparison.status,
      aggregate: comparison.aggregate,
      historical_final_loss: null,
      cap: comparison.cap,
      basis_identifier: comparison.basisIdentifier,
      basis_hash: null,
      verification: null,
      producer_warnings: [],
      reason:
        comparison.status === "unavailable"
          ? "The immutable build does not include target-loss attribution."
          : null,
      targets: [],
    },
    rows: index.targets.map((target) => target.comparison.row),
  } as unknown as Calibration;
}

export function buildTargetChangeDatasetFromIndexes(
  current: CalibrationTreeTargetIndexArtifact,
  candidate: CalibrationTreeTargetIndexArtifact,
): TargetChangeDataset {
  if (current.country !== candidate.country) {
    throw new Error("Calibration builds from different countries cannot be compared.");
  }
  return buildTargetChangeDataset(
    calibrationFromTargetIndex(current),
    calibrationFromTargetIndex(candidate),
  );
}
