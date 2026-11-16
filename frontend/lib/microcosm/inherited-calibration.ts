import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import type { CalibrationProvenance } from "@policyengine/calibration-tree/target-loss-attribution";

export interface InheritedCalibrationSource {
  parentBuildId: string;
  buildProgressHref: string | null;
}

export function inheritedCalibrationParent(
  _provenance: CalibrationProvenance | null | undefined,
): string | null {
  return null;
}

export function parentStagingRunId(
  _provenance: CalibrationProvenance | null | undefined,
  _country: MicrocosmCountry,
): string | undefined {
  return undefined;
}

export function buildProgressHref(_country: MicrocosmCountry, _runId: string): string {
  return "";
}

export function inheritedCalibrationSource(
  _provenance: CalibrationProvenance | null | undefined,
  _country: MicrocosmCountry,
  _parentRun: { run: { run_id: string } } | undefined,
): InheritedCalibrationSource | null {
  return null;
}
