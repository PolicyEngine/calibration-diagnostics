import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import {
  loadStagingCalibration,
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
        schema_version: 1,
        runs: [
          {
            run_id: "am-fixture",
            candidate_release_id: "am-candidate",
            status: "running",
          },
        ],
      });
    }
    if (url.includes("/tree/main/runs?recursive=true")) {
      return new Response(null, { status: 404 });
    }
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
      "https://huggingface.co/api/datasets/policyengine/microcosm-am-staging-fixture/tree/main/runs?recursive=true",
      "https://huggingface.co/datasets/policyengine/microcosm-am-staging-fixture/resolve/main/runs.json",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("names the country when staging is unavailable", () => {
  expect(stagingUnavailableReason("us")).toBeNull();
  expect(stagingUnavailableReason("uk")).toBeNull();
  expect(stagingUnavailableReason("be")).toBe(
    "Belgium has no staging repository.",
  );
  expect(stagingUnavailableReason("zz")).toBe(
    "Zedland has no staging repository.",
  );
});

const originalFetch = globalThis.fetch;
const originalUkRepo = process.env.POPULACE_UK_STAGING_HF_REPO;
const originalUkRevision = process.env.POPULACE_UK_STAGING_HF_REVISION;
const originalUkToken = process.env.POPULACE_UK_STAGING_HF_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUkRepo == null) delete process.env.POPULACE_UK_STAGING_HF_REPO;
  else process.env.POPULACE_UK_STAGING_HF_REPO = originalUkRepo;
  if (originalUkRevision == null) delete process.env.POPULACE_UK_STAGING_HF_REVISION;
  else process.env.POPULACE_UK_STAGING_HF_REVISION = originalUkRevision;
  if (originalUkToken == null) delete process.env.POPULACE_UK_STAGING_HF_TOKEN;
  else process.env.POPULACE_UK_STAGING_HF_TOKEN = originalUkToken;
});

function v2RunManifest(
  runId: string,
  updatedAt: string,
  startedAt = "2026-01-01T00:00:00+00:00",
) {
  return {
    schema_name: "microcosm.staging.run-manifest",
    schema_version: 2,
    run_id: runId,
    country_code: "GB",
    operation_id: "uk_frs_spine",
    pipeline: { id: "uk_national_spine", version: "2026.09" },
    candidate_id: `${runId}-candidate`,
    release_id: null,
    run_kind: "smoke",
    non_release: true,
    started_at: startedAt,
    updated_at: updatedAt,
    status: "completed",
    current_stage: "complete",
    sample: { mode: "full" },
    delivery: {
      contract_version: 2,
      enabled: true,
      mode: "local_only",
      run_id: runId,
      configured_repository: null,
      upload_attempts: 0,
      upload_successes: 0,
      read_back: "not_requested",
      last_error_code: null,
      opt_out_reason: null,
    },
    artifacts: [],
    failure: null,
    paths: {
      progress: `runs/${runId}/progress.json`,
      events: `runs/${runId}/events.ndjson`,
      calibration_progress: null,
    },
  };
}

function calibrationDiagnostics() {
  return {
    schema_version: 6,
    weight_entity: "household",
    options: {},
    n_nonzero: 2,
    n_records: 2,
    initial_loss: 0.2,
    final_loss: 0.05,
    fraction_within_10pct: 1,
    loss_trajectory: [0.2, 0.05],
    skipped: [],
    targets: [
      {
        name: "ons/employment_income/total@2025",
        target_name: "ons/employment_income/total",
        period: 2025,
        entity: "household",
        source: "ons",
        metadata: {
          variable: "employment_income",
          geography: "United Kingdom",
          geography_level: "national",
        },
        target: 100,
        initial_estimate: 80,
        final_estimate: 95,
        relative_error: -0.05,
        within_tolerance: true,
      },
    ],
  };
}

test("loads version 2 calibration diagnostics from the declared artifact path", async () => {
  const runId = "uk-calibration-with-diagnostics";
  const manifest = {
    ...v2RunManifest(runId, "2026-01-03T00:00:03+00:00"),
    operation_id: "uk_national_calibration",
    run_kind: "calibration",
    artifacts: [
      {
        logical_name: "calibration_diagnostics",
        artifact_kind: "aggregate_diagnostics",
        contract_relative_path: "artifacts/calibration_diagnostics.json",
        media_type: "application/json",
        sha256: "a".repeat(64),
        classification: "aggregate",
      },
    ],
  };
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith(`/runs/${runId}/run_manifest.json`)) {
      return Response.json(manifest);
    }
    if (url.endsWith(`/runs/${runId}/artifacts/calibration_diagnostics.json`)) {
      return Response.json(calibrationDiagnostics());
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const calibration = await loadStagingCalibration(runId, 0, "uk");

  expect(calibration?.release_id).toBe(`${runId}-candidate`);
  expect(calibration?.rows).toHaveLength(1);
  expect(calibration?.rows[0]?.final_estimate).toBe(95);
  expect(
    requested.some((url) =>
      url.endsWith(`/runs/${runId}/artifacts/calibration_diagnostics.json`),
    ),
  ).toBe(true);
  expect(
    requested.some((url) =>
      url.endsWith(`/runs/${runId}/calibration_diagnostics.json`),
    ),
  ).toBe(false);
});

test("keeps the version 1 calibration diagnostics path", async () => {
  const runId = "legacy-calibration";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith(`/runs/${runId}/progress.json`)) {
      return Response.json({
        schema_version: 1,
        run_id: runId,
        candidate_release_id: "legacy-candidate",
      });
    }
    if (url.endsWith(`/runs/${runId}/run_manifest.json`)) {
      return Response.json({ schema_version: 1, run_id: runId });
    }
    if (url.endsWith(`/runs/${runId}/calibration_diagnostics.json`)) {
      return Response.json(calibrationDiagnostics());
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const calibration = await loadStagingCalibration(runId, 0, "us");

  expect(calibration?.release_id).toBe("legacy-candidate");
  expect(calibration?.rows[0]?.final_estimate).toBe(95);
});

test("UK staging reads use the private repository credential only on server fetches", async () => {
  const token = "hf_test_server_only_credential";
  const repo = "policyengine/test-uk-staging-private";
  const revision = "test-revision";
  process.env.POPULACE_UK_STAGING_HF_REPO = repo;
  process.env.POPULACE_UK_STAGING_HF_REVISION = revision;
  process.env.POPULACE_UK_STAGING_HF_TOKEN = token;

  const fixtureRoot = join(
    import.meta.dir,
    "fixtures",
    "staging-contract",
    "v2",
    "completed-spine",
  );
  const runId = "uk-spine-v2-fixture";
  const requested: { url: string; authorization: string | null }[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requested.push({ url, authorization: headers.get("Authorization") });
    if (url.includes(`/tree/${revision}/runs`)) {
      return Response.json([
        {
          type: "file",
          path: `runs/${runId}/run_manifest.json`,
        },
      ]);
    }
    const marker = `/resolve/${revision}/`;
    const relative = url.includes(marker) ? url.split(marker, 2)[1] : null;
    if (!relative) return new Response(null, { status: 404 });
    if (relative === "runs.json" || relative === "latest_staging.json") {
      return new Response(null, { status: 404 });
    }
    const path = join(fixtureRoot, relative);
    try {
      const content = readFileSync(path);
      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": relative.endsWith(".ndjson")
            ? "application/x-ndjson"
            : "application/json",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }) as typeof fetch;

  const runs = await loadStagingRuns(0, "uk");
  const detail = await loadStagingRun(runId, 0, "uk");

  expect(runs).toMatchObject({
    available: true,
    source_repo: repo,
    revision,
    runs: [
      {
        run_id: runId,
        country_code: "GB",
        run_kind: "smoke",
        non_release: true,
        schema_version: 2,
      },
    ],
  });
  expect(detail).toMatchObject({
    available: true,
    source_repo: repo,
    revision,
    run_id: runId,
    candidate_release_id: runId,
    release_id: null,
    country_code: "GB",
    run_kind: "smoke",
    non_release: true,
    schema_version: 2,
    delivery: { contract_version: 2, mode: "local_only" },
    calibration_progress: null,
    has_calibration: false,
  });
  expect(detail.events?.map((event) => event.stage)).toEqual([
    "created",
    "input_verification",
    "sampling",
    "construction",
    "validation",
    "spine_h5_creation",
    "sidecar_creation",
    "complete",
  ]);
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every((request) => request.url.includes(repo))).toBe(true);
  expect(requested.every((request) => request.authorization === `Bearer ${token}`)).toBe(
    true,
  );
  expect(requested.some((request) => request.url.endsWith("/runs.json"))).toBe(false);
  expect(
    requested.some((request) => request.url.endsWith("/latest_staging.json")),
  ).toBe(false);
  expect(JSON.stringify({ runs, detail })).not.toContain(token);
});

test("discovers and orders version 2 runs from paginated manifests only", async () => {
  const repo = "policyengine/test-uk-staging-private";
  const revision = "test-revision";
  process.env.POPULACE_UK_STAGING_HF_REPO = repo;
  process.env.POPULACE_UK_STAGING_HF_REVISION = revision;
  const treeUrl =
    `https://huggingface.co/api/datasets/${repo}/tree/${revision}/runs` +
    "?recursive=true";
  const nextUrl = `${treeUrl}&cursor=next`;
  const manifests = new Map<string, Record<string, unknown>>([
    [
      "alpha",
      v2RunManifest(
        "alpha",
        "2026-01-03T00:00:00+00:00",
        "2026-01-01T00:00:00+00:00",
      ),
    ],
    [
      "beta",
      v2RunManifest(
        "beta",
        "2026-01-03T00:00:00+00:00",
        "2026-01-02T00:00:00+00:00",
      ),
    ],
    [
      "zeta",
      v2RunManifest(
        "zeta",
        "2026-01-03T00:00:00+00:00",
        "2026-01-02T00:00:00+00:00",
      ),
    ],
    ["older", v2RunManifest("older", "2026-01-02T00:00:00+00:00")],
  ]);
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === treeUrl) {
      return Response.json(
        [
          { type: "file", path: "runs/older/run_manifest.json" },
          { type: "file", path: "runs/alpha/run_manifest.json" },
          { type: "file", path: "runs/ignored/progress.json" },
          { type: "directory", path: "runs/directory/run_manifest.json" },
          { type: "file", path: "runs/nested/run_manifest.json/extra" },
        ],
        { headers: { Link: `<${nextUrl}>; rel="next"` } },
      );
    }
    if (url === nextUrl) {
      return Response.json([
        { type: "file", path: "runs/beta/run_manifest.json" },
        { type: "file", path: "runs/zeta/run_manifest.json" },
      ]);
    }
    const match = /\/runs\/([^/]+)\/run_manifest\.json$/.exec(url);
    if (match && manifests.has(match[1])) {
      return Response.json(manifests.get(match[1]));
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const result = await loadStagingRuns(0, "uk");

  expect(result.runs.map((run) => run.run_id)).toEqual([
    "zeta",
    "beta",
    "alpha",
    "older",
  ]);
  expect(result.runs[0]?.run_id).toBe("zeta");
  expect(result.runs.every((run) => run.schema_version === 2)).toBe(true);
  expect(requested).not.toContain(
    `https://huggingface.co/datasets/${repo}/resolve/${revision}/runs.json`,
  );
  expect(requested.some((url) => url.endsWith("/latest_staging.json"))).toBe(false);
  expect(requested.some((url) => url.includes("/ignored/"))).toBe(false);
  expect(requested.some((url) => url.includes("/directory/"))).toBe(false);
});

test("rejects a version 2 manifest whose run id differs from its path", async () => {
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/tree/")) {
      return Response.json([
        { type: "file", path: "runs/listed/run_manifest.json" },
      ]);
    }
    if (url.endsWith("/runs/listed/run_manifest.json")) {
      return Response.json(
        v2RunManifest("different", "2026-01-01T00:00:00+00:00"),
      );
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).rejects.toThrow(/does not match/);
});

test("fails the version 2 run list when a listed manifest is unreadable", async () => {
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/tree/")) {
      return Response.json([
        { type: "file", path: "runs/missing/run_manifest.json" },
      ]);
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).rejects.toThrow(
    /Staging artifact not found.*run_manifest\.json/,
  );
});

test("fails the version 2 run list when a listed manifest is malformed", async () => {
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/tree/")) {
      return Response.json([
        { type: "file", path: "runs/malformed/run_manifest.json" },
      ]);
    }
    if (url.endsWith("/runs/malformed/run_manifest.json")) {
      return Response.json({
        ...v2RunManifest("malformed", "2026-01-01T00:00:00+00:00"),
        updated_at: null,
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).rejects.toThrow(/updated_at/);
});

test("fails explicitly when the staging repository tree cannot be read", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) =>
    new Response(null, { status: 500 })) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).rejects.toThrow(
    /Staging fetch failed 500: runs tree/,
  );
});

test("propagates a repository tree request error", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL): Promise<Response> => {
    throw new Error("tree request failed");
  }) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).rejects.toThrow(/tree request failed/);
});

test("reports an authenticated empty staging repository as available", async () => {
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/tree/")) return Response.json([]);
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).resolves.toEqual({
    available: true,
    source_repo: "policyengine/populace-uk-staging",
    revision: "main",
    truncated: false,
    runs: [],
  });
  expect(requested).toHaveLength(1);
  expect(requested[0]).toContain("/tree/");
});

test("reports a staging repository that cannot be read as unavailable", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) =>
    new Response(null, { status: 404 })) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).resolves.toMatchObject({
    available: false,
    source_repo: "policyengine/populace-uk-staging",
    revision: "main",
    detail: expect.stringContaining("is not visible (HTTP 404)"),
    runs: [],
  });
});

test("target-change cache duration follows whether a run can still change", () => {
  expect(stagingTargetChangeCacheTtlSeconds("passed")).toBe(21_600);
  expect(stagingTargetChangeCacheTtlSeconds("published")).toBe(21_600);
  expect(stagingTargetChangeCacheTtlSeconds("completed")).toBe(21_600);
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

test("orders version 2 runs by date-time instant across UTC offsets", async () => {
  const manifests = new Map([
    [
      "earlier",
      v2RunManifest("earlier", "2026-01-01T01:00:00+01:00"),
    ],
    ["later", v2RunManifest("later", "2026-01-01T00:30:00Z")],
  ]);

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/tree/")) {
      return Response.json(
        [...manifests.keys()].map((runId) => ({
          type: "file",
          path: `runs/${runId}/run_manifest.json`,
        })),
      );
    }
    const match = /\/runs\/([^/]+)\/run_manifest\.json$/.exec(url);
    if (match && manifests.has(match[1])) {
      return Response.json(manifests.get(match[1]));
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const result = await loadStagingRuns(0, "uk");

  expect(result.runs.map((run) => run.run_id)).toEqual(["later", "earlier"]);
});

test("rejects a successful non-array repository tree response", async () => {
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/tree/")) {
      return Response.json({ entries: [] });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  await expect(loadStagingRuns(0, "uk")).rejects.toThrow(
    /Incompatible staging data: runs tree response must be an array/,
  );
});
