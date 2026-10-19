import type { StagingComparisonRelease } from "@policyengine/calibration-tree/staging-artifact";

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
  updatedAt: string | null;
}

function buildInstant(build: TimestampedCalibrationBuild): number {
  const value = build.createdAt ?? build.updatedAt;
  const time = value == null ? Number.NaN : Date.parse(value);
  // An undated build sorts last rather than wherever NaN lands.
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Order build records by their actual RFC 3339 instant, not timestamp text. */
export function calibrationBuildsNewestFirst<
  T extends TimestampedCalibrationBuild,
>(builds: readonly T[]): T[] {
  return [...builds].sort((left, right) => {
    const leftTime = buildInstant(left);
    const rightTime = buildInstant(right);
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

interface ComparableCalibrationBuild {
  buildArtifactId: string;
  kind: "release" | "staging";
  releaseId: string | null;
}

/**
 * The published build the Staging comparison map starts from: the build of
 * the release the candidate is compared with when it is published, otherwise
 * the manifest's latest release, otherwise the newest build.
 */
export function defaultComparisonBuildArtifactId(options: {
  builds: readonly ComparableCalibrationBuild[];
  latestReleaseBuildArtifactId: string | null | undefined;
  comparisonReleaseId: string | undefined;
}): string {
  const comparisonBuild = options.comparisonReleaseId
    ? options.builds.find(
        (build) => build.kind === "release" && build.releaseId === options.comparisonReleaseId,
      )
    : undefined;
  return comparisonBuild?.buildArtifactId ??
    options.latestReleaseBuildArtifactId ??
    options.builds[0]?.buildArtifactId ??
    "";
}

export interface StagingComparisonBaseline {
  columnLabel: string;
  tabLabel: string;
  note: string | null;
}

/** How the Staging page names the release a candidate is compared with. */
export function stagingComparisonBaseline(
  comparisonRelease: StagingComparisonRelease | undefined,
): StagingComparisonBaseline {
  if (comparisonRelease?.basis === "newest_local_area_release") {
    return {
      columnLabel: "Local-area release",
      tabLabel: "Change from local-area release",
      note:
        `This local-area candidate is compared with ${comparisonRelease.release_id}, the most recently ` +
        "published build of the local-area release. That release is never promoted, " +
        "so it has no current build.",
    };
  }
  return {
    columnLabel: "Current release",
    tabLabel: "Change from current release",
    note: comparisonRelease?.local_area_candidate
      ? "No local-area release has been published, so this local-area candidate is " +
        `compared with the current release, ${comparisonRelease.release_id}, which calibrates a ` +
        "different set of targets."
      : null,
  };
}
