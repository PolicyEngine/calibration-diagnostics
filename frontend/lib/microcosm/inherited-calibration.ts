import { hasCapability, type MicrocosmCountry } from "@policyengine/calibration-tree/countries";
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

// The build whose calibration diagnostics this build carries, or null for a
// build calibrated on its own.
export function inheritedCalibrationParent(
  provenance: CalibrationProvenance | null | undefined,
): string | null {
  if (provenance?.mode !== "inherited") return null;
  const parentBuildId = provenance.calibration_source_id?.trim();
  return parentBuildId || null;
}

// The staging run to look up for the parent. Microcosm names a build's
// staging run after its build ID (the parent's build manifest records
// `staging.run_id` equal to its `build_id`), so the parent's build ID is the
// run ID. Undefined when there is no parent, or the country has no staging
// runs.
export function parentStagingRunId(
  provenance: CalibrationProvenance | null | undefined,
  country: MicrocosmCountry,
): string | undefined {
  const parentBuildId = inheritedCalibrationParent(provenance);
  return parentBuildId && hasCapability(country, "staging") ? parentBuildId : undefined;
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

// What the calibration map shows about an inherited calibration. `parentRun`
// is the build monitor's answer for the parent's staging run; the link is
// shown only for an answer about that run, since the query keeps the previous
// run's answer while the next loads, and the Build progress tab opens another
// run in place of one it cannot find.
export function inheritedCalibrationSource(
  provenance: CalibrationProvenance | null | undefined,
  country: MicrocosmCountry,
  parentRun: { run: { run_id: string } } | undefined,
): InheritedCalibrationSource | null {
  const parentBuildId = inheritedCalibrationParent(provenance);
  if (!parentBuildId) return null;
  const runId = parentStagingRunId(provenance, country);
  return {
    parentBuildId,
    buildProgressHref:
      runId && parentRun?.run.run_id === runId ? buildProgressHref(country, runId) : null,
  };
}
