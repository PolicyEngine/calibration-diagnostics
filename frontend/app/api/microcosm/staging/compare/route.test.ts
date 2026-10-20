import { expect, test } from "bun:test";

import type {
  StagingComparison,
  StagingComparisonRelease,
} from "@policyengine/calibration-tree/staging-artifact";
import { createStagingCompareHandler } from "./route";

const DENSE_NEWEST = "microcosm-uk-2024-25-dense-20261019T000432Z-ee5c2dbe";
const LOCAL_CANDIDATE_RUN = "uk-local-candidate-f100-s42-20261019T000432Z-ee5c2dbe";

// The route passes a loaded comparison through unchanged, so the stub
// carries only the field the Staging page reads to name the compared
// release, not a whole comparison.
function loadedComparison(runId: string, releaseId: string): StagingComparison {
  return {
    available: true,
    run_id: runId,
    a: { release_id: releaseId },
  } as unknown as StagingComparison;
}

function handler(resolved: StagingComparisonRelease) {
  const calls: { resolved: string[]; loaded: Array<[string, string, string]> } = {
    resolved: [],
    loaded: [],
  };
  const get = createStagingCompareHandler({
    resolveComparisonRelease: async (runId, country) => {
      calls.resolved.push(`${country}:${runId}`);
      return resolved;
    },
    loadComparison: async (runId, releaseId, _revalidate, country) => {
      calls.loaded.push([country, runId, releaseId]);
      return loadedComparison(runId, releaseId);
    },
  });
  return { get, calls };
}

test("a US candidate's comparison response is unchanged", async () => {
  const { get, calls } = handler({
    release_id: "populace-us-2024-spm-receipts-20260923",
    basis: "current_release",
    local_area_candidate: false,
  });
  const response = await get(new Request("http://dashboard.test/api/microcosm/staging/compare?country=us&run=us-run"));
  expect(await response.json()).toEqual({
    available: true,
    run_id: "us-run",
    a: { release_id: "populace-us-2024-spm-receipts-20260923" },
  });
  expect(calls.loaded).toEqual([["us", "us-run", "populace-us-2024-spm-receipts-20260923"]]);
});

test("a UK local-area candidate's comparison names the local-area release it uses", async () => {
  const resolved: StagingComparisonRelease = {
    release_id: DENSE_NEWEST,
    basis: "newest_local_area_release",
    local_area_candidate: true,
  };
  const { get, calls } = handler(resolved);
  const response = await get(new Request(
    `http://dashboard.test/api/microcosm/staging/compare?country=uk&run=${LOCAL_CANDIDATE_RUN}&release=latest`,
  ));
  expect(await response.json()).toEqual({
    available: true,
    run_id: LOCAL_CANDIDATE_RUN,
    a: { release_id: DENSE_NEWEST },
    comparison_release: resolved,
  });
  expect(calls.resolved).toEqual([`uk:${LOCAL_CANDIDATE_RUN}`]);
  expect(calls.loaded).toEqual([["uk", LOCAL_CANDIDATE_RUN, DENSE_NEWEST]]);
});

test("an explicitly requested release is compared as requested", async () => {
  const { get, calls } = handler({
    release_id: DENSE_NEWEST,
    basis: "newest_local_area_release",
    local_area_candidate: true,
  });
  await get(new Request(
    `http://dashboard.test/api/microcosm/staging/compare?country=uk&run=${LOCAL_CANDIDATE_RUN}&release=some-release`,
  ));
  expect(calls.resolved).toEqual([]);
  expect(calls.loaded).toEqual([["uk", LOCAL_CANDIDATE_RUN, "some-release"]]);
});
