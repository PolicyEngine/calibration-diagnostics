import { expect, test } from "bun:test";

import {
  calibrationBuildManifestState,
  calibrationBuildsNewestFirst,
  isStagingSelection,
  publishedReleaseSelection,
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
