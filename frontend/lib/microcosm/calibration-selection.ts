// Older dashboard links used `staging:<run_id>` on published-release pages.
// Those pages now discard the obsolete selector; staging candidates are
// reviewed only on the Staging candidates page.
export const STAGING_SELECTION_PREFIX = "staging:";

export function isStagingSelection(selection: string | null | undefined): boolean {
  return typeof selection === "string" && selection.startsWith(STAGING_SELECTION_PREFIX);
}

/** Keep published-release selectors off pages that do not review staging runs. */
export function publishedReleaseSelection(
  selection: string | null | undefined,
): string {
  return isStagingSelection(selection) ? "" : (selection ?? "");
}

interface TimestampedCalibrationBuild {
  buildArtifactId: string;
  createdAt: string | null;
  updatedAt: string;
}

/** Order build records by their actual RFC 3339 instant, not timestamp text. */
export function calibrationBuildsNewestFirst<
  T extends TimestampedCalibrationBuild,
>(builds: readonly T[]): T[] {
  return [...builds].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt ?? left.updatedAt);
    const rightTime = Date.parse(right.createdAt ?? right.updatedAt);
    return (
      rightTime - leftTime ||
      left.buildArtifactId.localeCompare(right.buildArtifactId)
    );
  });
}

export type CalibrationBuildManifestState =
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function calibrationBuildManifestState(options: {
  hasData: boolean;
  isLoading: boolean;
  hasError: boolean;
  buildCount: number;
}): CalibrationBuildManifestState {
  if (options.hasData) return options.buildCount > 0 ? "ready" : "empty";
  if (options.isLoading) return "loading";
  return options.hasError ? "error" : "loading";
}
