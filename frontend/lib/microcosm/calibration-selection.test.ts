import { expect, test } from "bun:test";

import { stagingTargetDetailPresentation } from "@/components/microcosm/staging-target-detail-presentation";
import { formatShortDateTime } from "@/components/shared/format";
import { microcosmStagingTargetChangeSourceParameters } from "@/lib/api/hooks/use-microcosm";
import {
  calibrationBuildManifestState,
  comparisonMapBuilds,
  isStagingSelection,
  publishedReleaseSelection,
  stagingComparisonBaseline,
  type ComparisonMapBuildSources,
} from "./calibration-selection";
import { targetChangeModeHelp } from "./target-change-visualization";

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
});

test("the fallback note says the dashboard has no local-area build, not that none was published", () => {
  // The fallback is chosen from the dashboard's build manifest alone. A
  // local-area release published on Hugging Face whose calibration tree the
  // dashboard has not built yet (tree publishing paused, or its role
  // unreadable) also lands here, so the note must not say that no local-area
  // release has been published.
  const fallback = stagingComparisonBaseline({
    release_id: NATIONAL_CURRENT,
    basis: "current_release",
    local_area_candidate: true,
  });
  expect(fallback).toEqual({
    releaseLabel: "Current release",
    tabLabel: "Change from current release",
    note:
      "The dashboard has no published calibration build of a local-area release, so " +
      `this local-area candidate is compared with the current release, ${NATIONAL_CURRENT}, ` +
      "which calibrates a different set of targets.",
  });
});

// Published builds the comparison map's "From" selector offers, as the build
// manifest lists them.
const NATIONAL_BUILD_PUBLISHED_AT = "2026-10-19T08:41:07Z";
const NATIONAL_RELEASE_BUILD = {
  buildArtifactId: "national-build",
  kind: "release" as const,
  releaseId: NATIONAL_CURRENT,
  stagingRunId: null,
  createdAt: NATIONAL_BUILD_PUBLISHED_AT,
  updatedAt: NATIONAL_BUILD_PUBLISHED_AT,
};
const DENSE_RELEASE_BUILD = {
  ...NATIONAL_RELEASE_BUILD,
  buildArtifactId: "dense-build",
  releaseId: DENSE_NEWEST,
};
const EARLIER_CANDIDATE_RUN = "uk-frs-calibration-attempt-20261017T101500Z-3f9a1c2e";
const EARLIER_CANDIDATE_PUBLISHED_AT = "2026-10-17T13:02:44Z";
const EARLIER_CANDIDATE_BUILD = {
  buildArtifactId: "earlier-candidate-build",
  kind: "staging" as const,
  releaseId: null,
  stagingRunId: EARLIER_CANDIDATE_RUN,
  createdAt: EARLIER_CANDIDATE_PUBLISHED_AT,
  updatedAt: EARLIER_CANDIDATE_PUBLISHED_AT,
};
const LOCAL_AREA_COMPARISON = {
  release_id: DENSE_NEWEST,
  basis: "newest_local_area_release",
  local_area_candidate: true,
} as const;
const NATIONAL_COMPARISON = {
  release_id: NATIONAL_CURRENT,
  basis: "current_release",
  local_area_candidate: false,
} as const;

// A local-area candidate is compared with the dense release; the user picks
// the national release build in "From".
const NATIONAL_BUILD_NAME =
  `${formatShortDateTime(NATIONAL_BUILD_PUBLISHED_AT)} · ${NATIONAL_CURRENT}`;

test("a release build the user picks in From is named by its date and release ID", () => {
  expect(stagingComparisonBaseline(LOCAL_AREA_COMPARISON, NATIONAL_RELEASE_BUILD)).toEqual({
    releaseLabel: `Build ${NATIONAL_BUILD_NAME}`,
    tabLabel: `Change from build ${NATIONAL_BUILD_NAME}`,
    note: null,
  });
});

test("the comparison map's mode help and target detail name the picked From build", () => {
  const { releaseLabel } = stagingComparisonBaseline(
    LOCAL_AREA_COMPARISON,
    NATIONAL_RELEASE_BUILD,
  );
  expect(targetChangeModeHelp(releaseLabel).reported).toEndWith(
    `subtract their contribution in the build ${NATIONAL_BUILD_NAME}.`,
  );
  const detail = stagingTargetDetailPresentation(null, null, null, releaseLabel);
  expect(detail.eyebrow).toBe(`Build ${NATIONAL_BUILD_NAME} calibration target`);
  expect(detail.metrics.map((metric) => metric.label)).toEqual([
    "Official target",
    `Build ${NATIONAL_BUILD_NAME} estimate`,
    "Candidate estimate",
    `Build ${NATIONAL_BUILD_NAME} error`,
    "Candidate release error",
    "Weighted target error change",
  ]);
});

test("a staging build the user picks in From is named by its date and run ID", () => {
  // A national candidate; the user picks an earlier candidate's published build.
  const candidateBuildName =
    `${formatShortDateTime(EARLIER_CANDIDATE_PUBLISHED_AT)} · ${EARLIER_CANDIDATE_RUN}`;
  expect(stagingComparisonBaseline(NATIONAL_COMPARISON, EARLIER_CANDIDATE_BUILD)).toEqual({
    releaseLabel: `Build ${candidateBuildName}`,
    tabLabel: `Change from build ${candidateBuildName}`,
    note: null,
  });
});

test("a picked From build drops the note explaining the server's choice of release", () => {
  expect(stagingComparisonBaseline(
    { ...NATIONAL_COMPARISON, local_area_candidate: true },
    EARLIER_CANDIDATE_BUILD,
  ).note).toBeNull();
});

test("a picked From build the publisher could not date is named by its run ID alone", () => {
  expect(stagingComparisonBaseline(NATIONAL_COMPARISON, {
    ...EARLIER_CANDIDATE_BUILD,
    createdAt: null,
    updatedAt: null,
  }).releaseLabel).toBe(`Build ${EARLIER_CANDIDATE_RUN}`);
});

test("without a pick, or with a pick of the compared release's build, the labels name the compared release", () => {
  const localArea = stagingComparisonBaseline(LOCAL_AREA_COMPARISON);
  expect(localArea.releaseLabel).toBe("Local-area release");
  expect(stagingComparisonBaseline(LOCAL_AREA_COMPARISON, null)).toEqual(localArea);
  expect(stagingComparisonBaseline(LOCAL_AREA_COMPARISON, undefined)).toEqual(localArea);
  expect(stagingComparisonBaseline(LOCAL_AREA_COMPARISON, DENSE_RELEASE_BUILD)).toEqual(localArea);
  expect(stagingComparisonBaseline(NATIONAL_COMPARISON, NATIONAL_RELEASE_BUILD)).toEqual(
    stagingComparisonBaseline(NATIONAL_COMPARISON),
  );
});

test("a national candidate's pick of its compared release's build keeps the release's labels", () => {
  // `/microcosm/staging/compare` sends `comparison_release` only for a
  // local-area candidate. For a US, Belgian or UK national candidate the
  // compared release is known only from the response's `a.release_id`.
  const current = stagingComparisonBaseline(undefined);
  expect(stagingComparisonBaseline(undefined, NATIONAL_RELEASE_BUILD, NATIONAL_CURRENT))
    .toEqual(current);
  // Another build is still named by its date and run ID.
  expect(stagingComparisonBaseline(undefined, EARLIER_CANDIDATE_BUILD, NATIONAL_CURRENT)
    .releaseLabel).toBe(
    `Build ${formatShortDateTime(EARLIER_CANDIDATE_PUBLISHED_AT)} · ${EARLIER_CANDIDATE_RUN}`,
  );
});
