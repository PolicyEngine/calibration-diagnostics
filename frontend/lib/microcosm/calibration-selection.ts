// A dashboard "release" selection names either a published release id or an
// unreleased staging candidate, `staging:<run_id>`, reviewed with the same
// pages as a release. Import-free so server routes and client views share it.
export const STAGING_SELECTION_PREFIX = "staging:";

export function isStagingSelection(selection: string | null | undefined): boolean {
  return typeof selection === "string" && selection.startsWith(STAGING_SELECTION_PREFIX);
}

/** The staging run id a selection names, or null for a release selection. */
export function stagingRunIdOf(selection: string | null | undefined): string | null {
  if (typeof selection !== "string" || !isStagingSelection(selection)) return null;
  const runId = selection.slice(STAGING_SELECTION_PREFIX.length).trim();
  return runId || null;
}

export function stagingSelectionFor(runId: string): string {
  return `${STAGING_SELECTION_PREFIX}${runId}`;
}

export const STAGING_CALIBRATION_UNAVAILABLE_DETAIL =
  "This staging run has not uploaded calibration diagnostics yet.";

/** A staging candidate was selected but has no calibration to show (HTTP 404). */
export class StagingCalibrationUnavailableError extends Error {}
