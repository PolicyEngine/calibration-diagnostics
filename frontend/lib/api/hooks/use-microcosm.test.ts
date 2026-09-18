import { expect, test } from "bun:test";

import { PUBLISHED_RELEASE_STALE_TIME_MS } from "@/lib/api/cache-policy";
import { createExplorerState } from "@/lib/microcosm/calibration-explorer";

import { microcosmCalibrationTreeQueryOptions } from "./use-microcosm";

test("published and staging calibration trees use the same client cache policy", () => {
  const state = createExplorerState();
  const published = microcosmCalibrationTreeQueryOptions(
    state,
    { kind: "release", release: "release-a" },
    "us",
  );
  const staging = microcosmCalibrationTreeQueryOptions(
    state,
    { kind: "staging", runId: "run-a" },
    "us",
  );

  expect(published.staleTime).toBe(PUBLISHED_RELEASE_STALE_TIME_MS);
  expect(staging.staleTime).toBe(PUBLISHED_RELEASE_STALE_TIME_MS);
  expect(published.gcTime).toBe(PUBLISHED_RELEASE_STALE_TIME_MS);
  expect(staging.gcTime).toBe(PUBLISHED_RELEASE_STALE_TIME_MS);
  expect(published.refetchInterval).toBe(false);
  expect(staging.refetchInterval).toBe(false);
  expect(staging.queryKey).not.toEqual(published.queryKey);
});
