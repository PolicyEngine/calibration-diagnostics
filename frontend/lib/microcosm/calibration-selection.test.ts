import { expect, test } from "bun:test";

import { microcosmStagingTargetChangeSourceParameters } from "@/lib/api/hooks/use-microcosm";
import {
  calibrationBuildManifestState,
  calibrationBuildsNewestFirst,
  comparisonMapBuilds,
  isStagingSelection,
  publishedReleaseSelection,
  stagingComparisonBaseline,
  type ComparisonMapBuildSources,
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

const PUBLISHED_BUILDS = [
  { buildArtifactId: "national-build", kind: "release" as const, releaseId: NATIONAL_CURRENT },
  { buildArtifactId: "dense-build", kind: "release" as const, releaseId: DENSE_NEWEST },
  { buildArtifactId: "candidate-build", kind: "staging" as const, releaseId: null },
];
const NO_PICKS = { from: null, to: null };
const NOTHING_LOADED: ComparisonMapBuildSources = {
  builds: [],
  latestReleaseBuildArtifactId: undefined,
  comparisonReleaseId: undefined,
  candidateBuildArtifactId: undefined,
};
// A local-area candidate the publisher has not built a tree for yet.
const MANIFEST_LOADED: ComparisonMapBuildSources = {
  builds: PUBLISHED_BUILDS,
  latestReleaseBuildArtifactId: "national-build",
  comparisonReleaseId: undefined,
  candidateBuildArtifactId: undefined,
};
const COMPARISON_LOADED: ComparisonMapBuildSources = {
  ...MANIFEST_LOADED,
  comparisonReleaseId: DENSE_NEWEST,
};

test("the comparison map's From build follows the comparison when it arrives after the build manifest", () => {
  // Each render's selector values, in the order the page usually loads.
  expect(comparisonMapBuilds(NO_PICKS, NOTHING_LOADED)).toEqual({ from: "", to: "" });
  // The build manifest responds first: the manifest's latest release.
  expect(comparisonMapBuilds(NO_PICKS, MANIFEST_LOADED)).toEqual({
    from: "national-build",
    to: "",
  });
  // `/microcosm/staging/compare` then names the local-area release.
  const shown = comparisonMapBuilds(NO_PICKS, COMPARISON_LOADED);
  expect(shown).toEqual({ from: "dense-build", to: "" });
  // So the "Change from local-area release" tab's live comparison reads the
  // local-area build, not the national one.
  expect(microcosmStagingTargetChangeSourceParameters(DENSE_NEWEST, shown.from)).toEqual({
    build: "dense-build",
  });
});

test("the comparison map's From build is the same when the comparison arrives first", () => {
  expect(comparisonMapBuilds(NO_PICKS, { ...NOTHING_LOADED, comparisonReleaseId: DENSE_NEWEST }))
    .toEqual({ from: "", to: "" });
  expect(comparisonMapBuilds(NO_PICKS, COMPARISON_LOADED).from).toBe("dense-build");
});

test("a build the user picks holds while the comparison loads or changes", () => {
  const picked = { from: "national-build", to: null };
  expect(comparisonMapBuilds(picked, MANIFEST_LOADED).from).toBe("national-build");
  expect(comparisonMapBuilds(picked, COMPARISON_LOADED).from).toBe("national-build");
  // A pick that is no longer a published build gives way to the default.
  expect(comparisonMapBuilds({ from: "withdrawn-build", to: null }, COMPARISON_LOADED).from)
    .toBe("dense-build");
});

test("the To selector starts at the run's published build and keeps a pick of the live candidate", () => {
  const withCandidateBuild = { ...COMPARISON_LOADED, candidateBuildArtifactId: "candidate-build" };
  expect(comparisonMapBuilds(NO_PICKS, withCandidateBuild).to).toBe("candidate-build");
  // The empty value is the selector's live-candidate option.
  expect(comparisonMapBuilds({ from: null, to: "" }, withCandidateBuild).to).toBe("");
  expect(comparisonMapBuilds({ from: null, to: "national-build" }, withCandidateBuild).to)
    .toBe("national-build");
  expect(comparisonMapBuilds({ from: null, to: "withdrawn-build" }, withCandidateBuild).to)
    .toBe("candidate-build");
});

test("without a published build of the comparison's release, From starts at the manifest's latest release", () => {
  // US, Belgium and UK national candidates before the comparison responds.
  expect(comparisonMapBuilds(NO_PICKS, MANIFEST_LOADED).from).toBe("national-build");
  expect(comparisonMapBuilds(NO_PICKS, {
    ...MANIFEST_LOADED,
    comparisonReleaseId: "unpublished-release",
  }).from).toBe("national-build");
  expect(comparisonMapBuilds(NO_PICKS, {
    ...MANIFEST_LOADED,
    latestReleaseBuildArtifactId: null,
  }).from).toBe("national-build");
});

test("the Staging page names the release a candidate is compared with", () => {
  const current = {
    releaseLabel: "Current release",
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
    releaseLabel: "Local-area release",
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
