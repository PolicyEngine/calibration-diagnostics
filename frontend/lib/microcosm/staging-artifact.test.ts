import { expect, test } from "bun:test";

import {
  loadStagingComparison,
  loadStagingRun,
  loadStagingRuns,
  loadStagingTargetDiagnostics,
  MICROCOSM_STAGING_HF_REPO,
  MICROCOSM_STAGING_HF_REVISION,
  stagingRepository,
  stagingResolveUrl,
  stagingTargetChangeCacheTtlSeconds,
  stagingUnavailableReason,
} from "./staging-artifact";

test("resolves staging repositories from each country registration", () => {
  expect(stagingRepository("us")).toEqual({
    repo: "policyengine/populace-us-staging",
    revision: "main",
  });
  expect(MICROCOSM_STAGING_HF_REPO).toBe("policyengine/populace-us-staging");
  expect(MICROCOSM_STAGING_HF_REVISION).toBe("main");

  // Armenia is a fixture-only registration: this asserts country-specific
  // repository selection without publishing a country or telemetry artifact.
  expect(stagingRepository("am")).toEqual({
    repo: "policyengine/microcosm-am-staging-fixture",
    revision: "main",
  });
  expect(stagingResolveUrl("runs/am-fixture/progress.json", "am")).toBe(
    "https://huggingface.co/datasets/policyengine/microcosm-am-staging-fixture/resolve/main/runs/am-fixture/progress.json",
  );

  const originalRepo = process.env.POPULACE_STAGING_HF_REPO;
  const originalRevision = process.env.POPULACE_STAGING_HF_REVISION;
  try {
    process.env.POPULACE_STAGING_HF_REPO = "policyengine/us-staging-override";
    process.env.POPULACE_STAGING_HF_REVISION = "test-revision";
    expect(stagingRepository("us")).toEqual({
      repo: "policyengine/us-staging-override",
      revision: "test-revision",
    });
    expect(stagingRepository("am")).toEqual({
      repo: "policyengine/microcosm-am-staging-fixture",
      revision: "main",
    });
  } finally {
    if (originalRepo === undefined) delete process.env.POPULACE_STAGING_HF_REPO;
    else process.env.POPULACE_STAGING_HF_REPO = originalRepo;
    if (originalRevision === undefined) delete process.env.POPULACE_STAGING_HF_REVISION;
    else process.env.POPULACE_STAGING_HF_REVISION = originalRevision;
  }
});

test("loads Armenia staging telemetry from Armenia's registered repository", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/runs.json")) {
      return Response.json({
        runs: [
          {
            run_id: "am-fixture",
            candidate_release_id: "am-candidate",
            status: "running",
          },
        ],
      });
    }
    if (url.includes("/tree/main/runs?recursive=true")) return Response.json([]);
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  try {
    await expect(loadStagingRuns(0, "am")).resolves.toMatchObject({
      available: true,
      source_repo: "policyengine/microcosm-am-staging-fixture",
      revision: "main",
      runs: [{ run_id: "am-fixture", candidate_release_id: "am-candidate" }],
    });
    expect(urls).toEqual([
      "https://huggingface.co/datasets/policyengine/microcosm-am-staging-fixture/resolve/main/runs.json",
      "https://huggingface.co/api/datasets/policyengine/microcosm-am-staging-fixture/tree/main/runs?recursive=true",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
