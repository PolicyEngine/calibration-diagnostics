import { expect, test } from "bun:test";

import { createExplorerState } from "@/lib/microcosm/calibration-explorer";

import {
  fetchCalibrationTreePartsConcurrently,
  microcosmComparisonTargetDetailQueryOptions,
  microcosmComparisonTreeIndexQueryOptions,
  microcosmStagingCalibrationTreeQueryOptions,
} from "./use-microcosm";

test("calibration tree part requests start without waiting for earlier parts", async () => {
  const started: string[] = [];
  const resolve = new Map<string, () => void>();
  let completed = false;

  const loading = fetchCalibrationTreePartsConcurrently(
    ["filter-index", "target-summary-0001", "tier-1"],
    (part) => {
      started.push(part);
      return new Promise<void>((done) => resolve.set(part, done));
    },
  );
  void loading.then(() => {
    completed = true;
  });

  expect(started).toEqual(["filter-index", "target-summary-0001", "tier-1"]);
  resolve.get("tier-1")!();
  resolve.get("filter-index")!();
  await Promise.resolve();
  expect(completed).toBe(false);

  resolve.get("target-summary-0001")!();
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

test("comparison target-detail queries are keyed by immutable build and ordinal", () => {
  const build = "c".repeat(64);
  const options = microcosmComparisonTargetDetailQueryOptions("uk", build, 17);

  expect(options.queryKey).toEqual([
    "microcosm",
    "calibration-comparison-target-detail",
    "uk",
    build,
    17,
  ]);
});
