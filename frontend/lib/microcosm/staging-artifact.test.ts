import { expect, test } from "bun:test";

import {
  loadStagingComparison,
  loadStagingRun,
  loadStagingRuns,
  loadStagingTargetDiagnostics,
  stagingTargetChangeCacheTtlSeconds,
  stagingUnavailableReason,
} from "./staging-artifact";

test("names the country when staging is unavailable", () => {
  expect(stagingUnavailableReason("us")).toBeNull();
  expect(stagingUnavailableReason("uk")).toBe(
    "United Kingdom has no staging repository.",
  );
  expect(stagingUnavailableReason("be")).toBe(
    "Belgium has no staging repository.",
  );
  expect(stagingUnavailableReason("zz")).toBe(
    "Zedland has no staging repository.",
  );
});

test("target-change cache duration follows whether a run can still change", () => {
  expect(stagingTargetChangeCacheTtlSeconds("passed")).toBe(21_600);
  expect(stagingTargetChangeCacheTtlSeconds("published")).toBe(21_600);
  expect(stagingTargetChangeCacheTtlSeconds("failed")).toBe(21_600);
  expect(stagingTargetChangeCacheTtlSeconds("running")).toBe(30);
  expect(stagingTargetChangeCacheTtlSeconds("stalled")).toBe(30);
  expect(stagingTargetChangeCacheTtlSeconds(null)).toBe(30);
});

test("Belgium staging loaders return an empty state before resolving artifacts", async () => {
  const unavailable = {
    available: false as const,
    source_repo: null,
    revision: null,
    detail: "Belgium has no staging repository.",
  };

  expect(await loadStagingRuns(0, "be")).toEqual({
    ...unavailable,
    truncated: false,
    runs: [],
  });
  expect(await loadStagingRun("", 0, "be")).toMatchObject({
    ...unavailable,
    run_id: "",
    has_calibration: false,
    calibration: null,
  });
  expect(
    await loadStagingTargetDiagnostics("http://example.test", "", 0, "be"),
  ).toEqual({ ...unavailable, run_id: "" });
  expect(await loadStagingComparison("", "latest", 0, "be")).toEqual({
    ...unavailable,
    run_id: "",
  });
});
