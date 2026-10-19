import { expect, test } from "bun:test";

import {
  emptyCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifest,
  type CalibrationTreeManifestEntry,
} from "./calibration-tree-manifest";
import { stagingLocalAreaPipelines } from "./countries";
import type { ReleaseEntry } from "./latest-artifact";
import {
  newestPublishedLocalAreaRelease,
  resolveStagingComparisonRelease,
  stagingRunPipelineId,
  stagingResolveUrl,
  type StagingComparisonReleaseDependencies,
} from "./staging-artifact";

// UK shapes as published on 19 Oct 2026. A local-area candidate's staged
// receipt and run manifest record no dataset role, and its dataset file name
// changed between builds (microcosm_uk_2025_local.h5 in September,
// microcosm_uk_2024_25_local.h5 in October). The run manifest's pipeline id,
// which the staging contract validates, is stable: uk-local-candidate for
// local-area candidates and uk-frs-calibration for national attempts.
const NATIONAL_FOLDER = "microcosm-uk-2024-25-national";
const DENSE_FOLDER = "microcosm-uk-2024-25-dense";
const NATIONAL_CURRENT = `${NATIONAL_FOLDER}-20261019T083323Z-6cba5d71`;
const NATIONAL_EARLIER = `${NATIONAL_FOLDER}-20261014T214443Z-d12ff9b3`;
const DENSE_EARLIER = `${DENSE_FOLDER}-20261005T101500Z-0d0d0d0d`;
const DENSE_NEWEST = `${DENSE_FOLDER}-20261019T000432Z-ee5c2dbe`;
const JUNE_RELEASE = "populace-uk-2023-dd68c73-4aa4b14-20260619T023711Z";
const LOCAL_CANDIDATE_RUN = "uk-local-candidate-f100-s42-20261019T000432Z-ee5c2dbe";
const NATIONAL_ATTEMPT_RUN = "uk-frs-calibration-attempt-20261019T083323Z-6cba5d71";

function releaseBuild(
  releaseId: string,
  createdAt: string,
  buildDigit: string,
  releaseDirectory?: string,
): CalibrationTreeManifestEntry {
  return {
    buildArtifactId: buildDigit.repeat(64),
    kind: "release",
    sourceId: releaseId,
    label: releaseId,
    releaseId,
    ...(releaseDirectory ? { releaseDirectory } : {}),
    stagingRunId: null,
    hfRepo: "policyengine/populace-uk-private",
    hfCommitSha: buildDigit.repeat(40),
    treeSchemaVersion: 6,
    indexSha256: "e".repeat(64),
    indexBytes: 10,
    createdAt,
    updatedAt: createdAt,
  };
}

function ukManifest(): CalibrationTreeManifest {
  const stagingBuild: CalibrationTreeManifestEntry = {
    ...releaseBuild(LOCAL_CANDIDATE_RUN, "2026-10-19T02:05:10.000Z", "9"),
    kind: "staging",
    releaseId: null,
    stagingRunId: LOCAL_CANDIDATE_RUN,
    hfRepo: "policyengine/populace-uk-staging",
  };
  return [
    releaseBuild(JUNE_RELEASE, "2026-06-19T02:38:38.000Z", "1"),
    releaseBuild(NATIONAL_EARLIER, "2026-10-14T22:09:45.000Z", "2", NATIONAL_FOLDER),
    releaseBuild(NATIONAL_CURRENT, "2026-10-19T10:21:22.000Z", "3", NATIONAL_FOLDER),
    releaseBuild(DENSE_EARLIER, "2026-10-05T10:20:00.000Z", "4", DENSE_FOLDER),
    releaseBuild(DENSE_NEWEST, "2026-10-19T07:53:18.000Z", "5", DENSE_FOLDER),
    stagingBuild,
  ].reduce(
    (manifest, entry) => withCalibrationTreeManifestEntry(manifest, "uk", entry),
    emptyCalibrationTreeManifest(),
  );
}

function inventoryEntry(releaseId: string, isLocalArea: boolean): ReleaseEntry {
  return {
    release_id: releaseId,
    date: releaseId,
    files: [],
    has_calibration: true,
    dataset_role: isLocalArea ? "non_default_local_area" : null,
    is_default: !isLocalArea,
    is_local_area: isLocalArea,
  };
}

// Roles as the release manifests record them (dataset_role), read the way the
// release picker reads them.
const UK_INVENTORY = [
  inventoryEntry(JUNE_RELEASE, false),
  inventoryEntry(NATIONAL_EARLIER, false),
  inventoryEntry(NATIONAL_CURRENT, false),
  inventoryEntry(DENSE_EARLIER, true),
  inventoryEntry(DENSE_NEWEST, true),
];

test("only the UK registration names a staging pipeline that builds local-area candidates", () => {
  expect(stagingLocalAreaPipelines("uk")).toEqual(["uk-local-candidate"]);
  expect(stagingLocalAreaPipelines("us")).toEqual([]);
  expect(stagingLocalAreaPipelines("be")).toEqual([]);
});

test("the newest local-area release build is the latest one the publisher's manifest records", () => {
  expect(newestPublishedLocalAreaRelease(ukManifest(), "uk", UK_INVENTORY)?.releaseId)
    .toBe(DENSE_NEWEST);
  // Without a local-area role in the inventory, no release qualifies.
  expect(newestPublishedLocalAreaRelease(
    ukManifest(),
    "uk",
    UK_INVENTORY.map((entry) => ({ ...entry, is_local_area: false })),
  )).toBeNull();
});

function dependencies(
  overrides: Partial<StagingComparisonReleaseDependencies>,
): StagingComparisonReleaseDependencies {
  return {
    runPipelineId: async () => {
      throw new Error("The run's pipeline must not be read.");
    },
    currentReleaseId: async () => {
      throw new Error("The current release must not be read.");
    },
    newestLocalAreaReleaseId: async () => {
      throw new Error("The local-area release must not be read.");
    },
    ...overrides,
  };
}

test("US and Belgian staging candidates keep comparing with the current release", async () => {
  for (const [country, current] of [
    ["us", "populace-us-2024-spm-receipts-20260923"],
    ["be", "microcosm-be-2026-chronicle-3cef97b-20260823T134247Z"],
  ] as const) {
    await expect(resolveStagingComparisonRelease(
      "any-run",
      country,
      dependencies({ currentReleaseId: async () => current }),
    )).resolves.toEqual({
      release_id: current,
      basis: "current_release",
      local_area_candidate: false,
    });
  }
});

test("a UK national candidate compares with the current national build", async () => {
  await expect(resolveStagingComparisonRelease(
    NATIONAL_ATTEMPT_RUN,
    "uk",
    dependencies({
      runPipelineId: async () => "uk-frs-calibration",
      currentReleaseId: async () => NATIONAL_CURRENT,
    }),
  )).resolves.toEqual({
    release_id: NATIONAL_CURRENT,
    basis: "current_release",
    local_area_candidate: false,
  });
});

test("a UK local-area candidate compares with the newest published local-area build", async () => {
  await expect(resolveStagingComparisonRelease(
    LOCAL_CANDIDATE_RUN,
    "uk",
    dependencies({
      runPipelineId: async () => "uk-local-candidate",
      newestLocalAreaReleaseId: async () => DENSE_NEWEST,
    }),
  )).resolves.toEqual({
    release_id: DENSE_NEWEST,
    basis: "newest_local_area_release",
    local_area_candidate: true,
  });
});

test("a UK local-area candidate with no published local-area release falls back to the current release", async () => {
  await expect(resolveStagingComparisonRelease(
    LOCAL_CANDIDATE_RUN,
    "uk",
    dependencies({
      runPipelineId: async () => "uk-local-candidate",
      newestLocalAreaReleaseId: async () => null,
      currentReleaseId: async () => NATIONAL_CURRENT,
    }),
  )).resolves.toEqual({
    release_id: NATIONAL_CURRENT,
    basis: "current_release",
    local_area_candidate: true,
  });
});

test("a staging run's pipeline id is read from its run manifest", async () => {
  const originalFetch = globalThis.fetch;
  const manifestUrl = stagingResolveUrl(`runs/${LOCAL_CANDIDATE_RUN}/run_manifest.json`, "uk");
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === manifestUrl) {
      return Response.json({
        schema_version: 3,
        run_id: LOCAL_CANDIDATE_RUN,
        pipeline: { id: "uk-local-candidate", version: "0.1.0" },
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    await expect(stagingRunPipelineId(LOCAL_CANDIDATE_RUN, 0, "uk")).resolves.toBe("uk-local-candidate");
    await expect(stagingRunPipelineId("missing-run", 0, "uk")).resolves.toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
