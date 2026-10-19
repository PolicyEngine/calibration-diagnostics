import { expect, test } from "bun:test";

import {
  calibrationBuildManifestState,
  calibrationBuildsNewestFirst,
  defaultComparisonBuildArtifactId,
  isStagingSelection,
  publishedReleaseSelection,
  stagingComparisonBaseline,
} from "./calibration-selection";

test("recognizes obsolete staging selectors without treating releases as staging", () => {
  expect(isStagingSelection("staging:uk-candidate")).toBe(true);
  expect(isStagingSelection("latest")).toBe(false);
  expect(isStagingSelection("")).toBe(false);
  expect(isStagingSelection(undefined)).toBe(false);
});

test("published-release pages discard staging candidate selectors", () => {
  expect(publishedReleaseSelection("staging:uk-candidate")).toBe("");
  expect(publishedReleaseSelection("populace-uk-2023-release")).toBe(
    "populace-uk-2023-release",
  );
  expect(publishedReleaseSelection(undefined)).toBe("");
});

test("orders calibration builds by instant across RFC 3339 offsets", () => {
  const builds = [
    {
      buildArtifactId: "offset-earlier",
      createdAt: "2026-01-01T00:30:00+02:00",
      updatedAt: "2026-01-01T00:30:00+02:00",
    },
    {
      buildArtifactId: "utc-later",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      buildArtifactId: "same-instant-b",
      createdAt: null,
      updatedAt: "2025-12-31T19:00:00-05:00",
    },
    {
      buildArtifactId: "same-instant-a",
      createdAt: "2026-01-01T00:00:00+00:00",
      updatedAt: "2026-01-01T00:00:00+00:00",
    },
  ];

  expect(
    calibrationBuildsNewestFirst(builds).map((build) => build.buildArtifactId),
  ).toEqual([
    "same-instant-a",
    "same-instant-b",
    "utc-later",
    "offset-earlier",
  ]);
  expect(builds.map((build) => build.buildArtifactId)).toEqual([
    "offset-earlier",
    "utc-later",
    "same-instant-b",
    "same-instant-a",
  ]);
});

test("distinguishes build-manifest loading, error, empty, and ready states", () => {
  expect(calibrationBuildManifestState({
    hasData: false,
    isLoading: true,
    hasError: false,
    buildCount: 0,
  })).toBe("loading");
  expect(calibrationBuildManifestState({
    hasData: false,
    isLoading: false,
    hasError: true,
    buildCount: 0,
  })).toBe("error");
  expect(calibrationBuildManifestState({
    hasData: true,
    isLoading: false,
    hasError: false,
    buildCount: 0,
  })).toBe("empty");
  expect(calibrationBuildManifestState({
    hasData: true,
    isLoading: false,
    hasError: false,
    buildCount: 2,
  })).toBe("ready");
  expect(calibrationBuildManifestState({
    hasData: true,
    isLoading: false,
    hasError: true,
    buildCount: 2,
  })).toBe("ready");
});

test("an undated calibration build sorts after every dated one", () => {
  const builds = [
    { buildArtifactId: "undated-b", createdAt: null, updatedAt: null },
    {
      buildArtifactId: "dated",
      createdAt: "2026-10-04T18:57:22Z",
      updatedAt: "2026-10-04T18:57:22Z",
    },
    { buildArtifactId: "undated-a", createdAt: null, updatedAt: null },
  ];
  expect(
    calibrationBuildsNewestFirst(builds).map((build) => build.buildArtifactId),
  ).toEqual(["dated", "undated-a", "undated-b"]);
});

const DENSE_NEWEST = "microcosm-uk-2024-25-dense-20261019T000432Z-ee5c2dbe";
const NATIONAL_CURRENT = "microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71";

test("the comparison map starts from the build of the release the candidate is compared with", () => {
  const builds = [
    { buildArtifactId: "national-build", kind: "release" as const, releaseId: NATIONAL_CURRENT },
    { buildArtifactId: "dense-build", kind: "release" as const, releaseId: DENSE_NEWEST },
    { buildArtifactId: "candidate-build", kind: "staging" as const, releaseId: null },
  ];
  expect(defaultComparisonBuildArtifactId({
    builds,
    latestReleaseBuildArtifactId: "national-build",
    comparisonReleaseId: DENSE_NEWEST,
  })).toBe("dense-build");
  // US, Belgium and UK national candidates: the manifest's latest release.
  expect(defaultComparisonBuildArtifactId({
    builds,
    latestReleaseBuildArtifactId: "national-build",
    comparisonReleaseId: undefined,
  })).toBe("national-build");
  expect(defaultComparisonBuildArtifactId({
    builds,
    latestReleaseBuildArtifactId: "national-build",
    comparisonReleaseId: "unpublished-release",
  })).toBe("national-build");
  expect(defaultComparisonBuildArtifactId({
    builds: [],
    latestReleaseBuildArtifactId: null,
    comparisonReleaseId: undefined,
  })).toBe("");
});

test("the Staging page names the release a candidate is compared with", () => {
  const current = {
    columnLabel: "Current release",
    tabLabel: "Change from current release",
    note: null,
  };
  expect(stagingComparisonBaseline(undefined)).toEqual(current);
  expect(stagingComparisonBaseline({
    release_id: NATIONAL_CURRENT,
    basis: "current_release",
    local_area_candidate: false,
  })).toEqual(current);
  expect(stagingComparisonBaseline({
    release_id: DENSE_NEWEST,
    basis: "newest_local_area_release",
    local_area_candidate: true,
  })).toEqual({
    columnLabel: "Local-area release",
    tabLabel: "Change from local-area release",
    note:
      `This local-area candidate is compared with ${DENSE_NEWEST}, the most recently ` +
      "published build of the local-area release. That release is never promoted, " +
      "so it has no current build.",
  });
  expect(stagingComparisonBaseline({
    release_id: NATIONAL_CURRENT,
    basis: "current_release",
    local_area_candidate: true,
  })).toEqual({
    ...current,
    note:
      "No local-area release has been published, so this local-area candidate is " +
      `compared with the current release, ${NATIONAL_CURRENT}, which calibrates a ` +
      "different set of targets.",
  });
});
