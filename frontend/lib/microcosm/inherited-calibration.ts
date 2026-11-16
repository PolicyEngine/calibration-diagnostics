import { hasCapability, type MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import type { CalibrationProvenance } from "@policyengine/calibration-tree/target-loss-attribution";

import { STAGING_RUN_PARAM } from "@/lib/microcosm/staging-run-url";

// A release build can reuse another build's calibration: a compatibility
// recertification copies its parent build's calibration diagnostics, and its
// build manifest declares `calibration.mode` "inherited" with
// `calibration.parent_build_id`. The tree package reads that manifest into the
// calibration tree's provenance, which names the parent in
// `calibration_source_id`.
//
// The parent's staging run is not always named after the parent's build ID
// (the US certified-build tool can stage under `populace-us-build-<time>-<hex>`),
// so it is read from the parent's own build manifest, which a recertification
// carries in its folder as `parent_build_manifest.json`.

export const PARENT_BUILD_MANIFEST_FILE = "parent_build_manifest.json";

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

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// The build whose calibration diagnostics this build carries, or null for a
// build calibrated on its own.
export function inheritedCalibrationParent(
  provenance: CalibrationProvenance | null | undefined,
): string | null {
  if (provenance?.mode !== "inherited") return null;
  return nonEmptyString(provenance.calibration_source_id);
}

// The parent build and its staging run, from the parent's build manifest: a
// tagged build names itself in `build_id`, a build-folder build in `build`.
// The run counts only when the manifest says staging was enabled.
export function parentBuildFromManifest(
  manifest: Record<string, unknown> | null,
): Pick<ParentBuildResponse, "parent_build_id" | "staging_run_id"> {
  if (!manifest) return { parent_build_id: null, staging_run_id: null };
  const staging = objectValue(manifest.staging);
  return {
    parent_build_id: nonEmptyString(manifest.build_id) ?? nonEmptyString(manifest.build),
    staging_run_id: staging?.enabled === true ? nonEmptyString(staging.run_id) : null,
  };
}

// The release build to ask `/api/microcosm/parent-build` about: only one whose
// calibration is inherited, in a country with staging runs to link to.
export function parentBuildRelease(
  provenance: CalibrationProvenance | null | undefined,
  country: MicrocosmCountry,
  releaseId: string | undefined,
): string | undefined {
  return releaseId && inheritedCalibrationParent(provenance) && hasCapability(country, "staging")
    ? releaseId
    : undefined;
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

// What the calibration map shows about an inherited calibration. The link
// needs the parent build manifest's staging run, and only when that manifest
// is the parent's the calibration names.
export function inheritedCalibrationSource(
  provenance: CalibrationProvenance | null | undefined,
  country: MicrocosmCountry,
  parentBuild: ParentBuildResponse | undefined,
): InheritedCalibrationSource | null {
  const parentBuildId = inheritedCalibrationParent(provenance);
  if (!parentBuildId) return null;
  const runId =
    hasCapability(country, "staging") && parentBuild?.parent_build_id === parentBuildId
      ? parentBuild.staging_run_id
      : null;
  return {
    parentBuildId,
    buildProgressHref: runId ? buildProgressHref(country, runId) : null,
  };
}
