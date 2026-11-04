import { expect, test } from "bun:test";

import { createExplorerState } from "@policyengine/calibration-tree/calibration-explorer";

import {
  fetchCalibrationTreePartsConcurrently,
  microcosmComparisonTargetDetailQueryOptions,
  microcosmComparisonTreeIndexQueryOptions,
  microcosmStagingCalibrationTreeQueryOptions,
  microcosmStagingTargetChangeSourceParameters,
  releaseSelectOptions,
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

test("live candidates compare with the selected immutable staging build", () => {
  const build = "d".repeat(64);

  expect(
    microcosmStagingTargetChangeSourceParameters("latest-release", build),
  ).toEqual({ build });
  expect(
    microcosmStagingTargetChangeSourceParameters("latest-release"),
  ).toEqual({ release: "latest-release" });
});

test("the release picker keeps a withdrawn build selectable and labels it Withdrawn", () => {
  const release = "microcosm-uk-2024-25-national";
  const entry = (build: string, withdrawn: boolean) => ({
    release_id: `${release}/${build}`,
    date: "20261019T083323Z",
    files: [],
    has_calibration: true,
    release,
    build,
    withdrawn,
  });
  const withdrawn = entry("uk-frs-calibration-attempt-20261014T214443Z-d12ff9b3", true);
  const current = entry("uk-frs-calibration-attempt-20261019T083323Z-6cba5d71", false);
  const options = releaseSelectOptions({
    latest_release_id: current.release_id,
    updated_at: null,
    releases: [current, withdrawn],
    all_releases: [current, withdrawn],
  });
  const label = (id: string) => options.find((option) => option.value === id)?.label ?? "";
  expect(label(withdrawn.release_id)).toEndWith(" · Withdrawn");
  expect(label(current.release_id)).not.toContain("Withdrawn");
});

test("the picker's Latest option is labelled Withdrawn when the latest release is a withdrawn build", () => {
  const release = "microcosm-uk-2024-25-national";
  const build = "uk-frs-calibration-attempt-20261014T214443Z-d12ff9b3";
  const latest = {
    release_id: `${release}/${build}`,
    date: "20261014T214443Z",
    files: [],
    has_calibration: true,
    release,
    build,
    withdrawn: true,
  };
  const [latestOption] = releaseSelectOptions({
    latest_release_id: latest.release_id,
    updated_at: null,
    releases: [latest],
    all_releases: [latest],
  });
  expect(latestOption.value).toBe("");
  expect(latestOption.label).toStartWith("Latest · ");
  expect(latestOption.label).toEndWith(" · Withdrawn");
});
