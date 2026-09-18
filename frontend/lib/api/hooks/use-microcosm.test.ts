import { expect, test } from "bun:test";

import { createExplorerState } from "@/lib/microcosm/calibration-explorer";

import {
  fetchCalibrationTreeTiersConcurrently,
  microcosmComparisonTreeIndexQueryOptions,
  microcosmStagingCalibrationTreeQueryOptions,
} from "./use-microcosm";

test("calibration tree tier requests start without waiting for earlier tiers", async () => {
  const started: string[] = [];
  const resolve = new Map<string, () => void>();
  let completed = false;

  const loading = fetchCalibrationTreeTiersConcurrently(
    ["tier-1", "tier-2", "tier-3"],
    (tier) => {
      started.push(tier);
      return new Promise<void>((done) => resolve.set(tier, done));
    },
  );
  void loading.then(() => {
    completed = true;
  });

  expect(started).toEqual(["tier-1", "tier-2", "tier-3"]);
  resolve.get("tier-3")!();
  resolve.get("tier-1")!();
  await Promise.resolve();
  expect(completed).toBe(false);

  resolve.get("tier-2")!();
  await loading;
  expect(completed).toBe(true);
});

test("mutable staging calibration trees refresh every 30 seconds", () => {
  const options = microcosmStagingCalibrationTreeQueryOptions(
    createExplorerState(),
    "run-a",
    "us",
  );

  expect(options.staleTime).toBe(30 * 1000);
  expect(options.refetchInterval).toBe(30 * 1000);
  expect(options.queryKey).toContain("run-a");
});

test("immutable comparison queries include both ordered build identities and mode", () => {
  const current = "a".repeat(64);
  const candidate = "b".repeat(64);
  const options = microcosmComparisonTreeIndexQueryOptions(
    current,
    candidate,
    "shared",
    "us",
  );

  expect(options.queryKey).toEqual([
    "microcosm",
    "calibration-comparison-tree",
    "us",
    current,
    candidate,
    "shared",
    "index",
  ]);
});
