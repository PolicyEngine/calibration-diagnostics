import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import type { CalibrationProvenance } from "@policyengine/calibration-tree/target-loss-attribution";

import { STAGING_RUN_PARAM } from "@/lib/microcosm/staging-run-url";

// A release build can reuse another build's calibration: a compatibility
// recertification copies its parent build's calibration diagnostics, and its
// build manifest declares `calibration.mode` "inherited" with
// `calibration.parent_build_id`. The tree package reads that manifest into the
// calibration tree's provenance, which names the parent in
// `calibration_source_id`.

export interface InheritedCalibrationSource {
  parentBuildId: string;
  /** The parent's staging run on the Build progress tab; null when it has none. */
  buildProgressHref: string | null;
}

/** The `/api/microcosm/parent-build` answer for one release build. */
export interface ParentBuildResponse {
  release_id: string;
  parent_build_id: string | null;
  staging_run_id: string | null;
}

// The build whose calibration diagnostics this build carries, or null for a
// build calibrated on its own.
export function inheritedCalibrationParent(
  provenance: CalibrationProvenance | null | undefined,
): string | null {
  if (provenance?.mode !== "inherited") return null;
  const parentBuildId = provenance.calibration_source_id?.trim();
  return parentBuildId || null;
}

export function parentBuildFromManifest(
  _manifest: Record<string, unknown> | null,
): Pick<ParentBuildResponse, "parent_build_id" | "staging_run_id"> {
  return { parent_build_id: null, staging_run_id: null };
}

export function parentBuildRelease(
  _provenance: CalibrationProvenance | null | undefined,
  _country: MicrocosmCountry,
  _releaseId: string | undefined,
): string | undefined {
  return undefined;
}

// The Staging page's Build progress tab, opened at `runId`.
export function buildProgressHref(country: MicrocosmCountry, runId: string): string {
  const query = new URLSearchParams({
    country,
    [STAGING_RUN_PARAM]: runId,
    view: "progress",
  });
  return `/microcosm/staging?${query.toString()}`;
}

export function inheritedCalibrationSource(
  provenance: CalibrationProvenance | null | undefined,
  _country: MicrocosmCountry,
  _parentBuild: ParentBuildResponse | undefined,
): InheritedCalibrationSource | null {
  const parentBuildId = inheritedCalibrationParent(provenance);
  if (!parentBuildId) return null;
  return { parentBuildId, buildProgressHref: null };
}
