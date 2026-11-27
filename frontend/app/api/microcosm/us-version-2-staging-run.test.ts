// A US fiscal refresh build's staging run as the version 2 writer stages it
// (PolicyEngine/microcosm#1135), read through the Staging routes' own handlers
// against a fake collector store: its list entry, its detail, its calibration
// and its reform validation, which version 2 writes under `artifacts/`. A
// version 1 run's top-level reform validation is still read.
import { afterEach, beforeEach, expect, test } from "bun:test";

import {
  isStagingRunFileName,
  STAGING_RUN_FILE_NAMES,
} from "@policyengine/calibration-tree/staging-run-files";

import diagnosticsFixture from "@/lib/microcosm/fixtures/zz-release/calibration_diagnostics.json";
import { clearBuildRunCaches, loadBuildRuns } from "@/lib/microcosm/build-runs";
import {
  FakeCollectorStore,
  type FakeStagingRun,
} from "@/lib/microcosm/test-support/fake-collector-store";
import {
  US_V2_BUILD_MANIFEST,
  US_V2_CANDIDATE,
  US_V2_RELEASE,
  US_V2_RELEASE_MANIFEST,
  US_V2_RUN,
  usV2CalibrationProgress,
  usV2Events,
  usV2Progress,
  usV2ReformValidation,
  usV2RunManifest,
} from "@/lib/microcosm/test-support/us-version-2-staging-run";

import { GET as stagingRun } from "./staging/run/route";
import { GET as stagingRuns } from "./staging/runs/route";
import { GET as stagingTargetTree } from "./staging/target-tree/route";

const COLLECTOR_SETTINGS = [
  "MICROCOSM_TELEMETRY_COLLECTOR_URL",
  "MICROCOSM_BUILD_MONITOR_COLLECTOR_ONLY",
] as const;
const originalCollectorSettings = Object.fromEntries(
  COLLECTOR_SETTINGS.map((name) => [name, process.env[name]]),
);

type RunFiles = FakeStagingRun["files"];

/** The run's copied files: its documents, declared result files and reform validation. */
function usV2RunFiles(overrides: Partial<RunFiles> = {}): RunFiles {
  return {
    "progress.json": usV2Progress(),
    "run_manifest.json": usV2RunManifest({ diagnostics: diagnosticsFixture }),
    "events.ndjson": usV2Events(),
    "calibration_progress.json": usV2CalibrationProgress(),
    "artifacts/reform_validation.json": usV2ReformValidation(),
    ...overrides,
  };
}

/** A store holding the US version 2 run's copies and its tree. */
function usV2Store(files: RunFiles = usV2RunFiles()): FakeCollectorStore {
  const store = new FakeCollectorStore();
  store.addBuild({
    country: "us",
    kind: "staging",
    stagingRunId: US_V2_RUN,
    label: US_V2_CANDIDATE,
    hfRepo: "policyengine/populace-us-staging",
    files: {
      calibrationDiagnostics: diagnosticsFixture,
      buildManifest: US_V2_BUILD_MANIFEST,
      releaseManifest: US_V2_RELEASE_MANIFEST,
    },
  });
  store.addStagingRun({ country: "us", runId: US_V2_RUN, files });
  return store;
}

let restore: (() => void) | null = null;

function serve(store: FakeCollectorStore): FakeCollectorStore {
  restore = store.install();
  return store;
}

beforeEach(() => {
  clearBuildRunCaches();
  // No collector: the Candidate tab shows the states the copied files record.
  for (const name of COLLECTOR_SETTINGS) delete process.env[name];
});

afterEach(() => {
  restore?.();
  restore = null;
  for (const name of COLLECTOR_SETTINGS) {
    const original = originalCollectorSettings[name];
    if (original == null) delete process.env[name];
    else process.env[name] = original;
  }
  clearBuildRunCaches();
});

function request(path: string): Request {
  return new Request(`https://dashboard.example/calibration/dashboard/api/microcosm${path}`);
}

async function runDetail(runId = US_V2_RUN) {
  const response = await stagingRun(request(`/staging/run?country=us&id=${runId}`));
  expect(response.status).toBe(200);
  return response.json();
}

test("the pinned package names a version 2 run's reform validation among a run's copied files", () => {
  expect(STAGING_RUN_FILE_NAMES).toContain("artifacts/reform_validation.json");
  expect(isStagingRunFileName("artifacts/reform_validation.json")).toBe(true);
});

test("the Candidate tab lists a US version 2 run with its version 2 identity", async () => {
  const store = serve(usV2Store());

  const response = await stagingRuns(request("/staging/runs?country=us"));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ available: true, incompatible_runs: [] });
  expect(body.runs).toEqual([
    expect.objectContaining({
      run_id: US_V2_RUN,
      candidate_release_id: US_V2_CANDIDATE,
      release_id: US_V2_RELEASE,
      country_code: "US",
      run_kind: "release",
      non_release: false,
      schema_version: 3,
      // The tab's state for a completed run, with the copy's own status.
      status: "passed",
      hugging_face_status: "completed",
      hugging_face_stage: "complete",
      started_at: "2026-11-27T01:00:00+00:00",
      state_source: "hugging_face",
    }),
  ]);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a US version 2 run's detail reads its copied version 3 documents", async () => {
  const store = serve(usV2Store());

  const body = await runDetail();

  expect(body).toMatchObject({
    available: true,
    source_repo: "policyengine/populace-us-staging",
    run_id: US_V2_RUN,
    candidate_release_id: US_V2_CANDIDATE,
    release_id: US_V2_RELEASE,
    country_code: "US",
    run_kind: "release",
    non_release: false,
    schema_version: 3,
    delivery: { mode: "local_and_remote", upload_successes: 3, read_back: "passed" },
    progress: { status: "completed", operation_id: "us_fiscal_refresh_build" },
    run_manifest: {
      pipeline: { id: "us_fiscal_refresh" },
      artifacts: {
        reform_validation: {
          path: "artifacts/reform_validation.json",
          staging_path: `runs/${US_V2_RUN}/artifacts/reform_validation.json`,
        },
      },
    },
    calibration_progress: { candidate_release_id: US_V2_CANDIDATE },
    state: { state_source: "hugging_face", status: "passed" },
  });
  expect(body.calibration_progress.events.map((event: { epoch: number }) => event.epoch)).toEqual([
    10, 100,
  ]);
  expect(body.events.map((event: { stage: string }) => event.stage)).toEqual([
    "created",
    "calibration",
    "calibration",
    "reform_validation",
    "complete",
  ]);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a US version 2 run's calibration comes from its declared diagnostics and manifests", async () => {
  const store = serve(usV2Store());

  const body = await runDetail();
  const tree = await stagingTargetTree(request(`/staging/target-tree?country=us&run=${US_V2_RUN}`));

  expect(body).toMatchObject({
    has_calibration: true,
    calibration: {
      source: "huggingface_live",
      release_id: US_V2_CANDIDATE,
      final_loss: 0.0125,
    },
    build_manifest: US_V2_BUILD_MANIFEST,
    release_manifest: US_V2_RELEASE_MANIFEST,
  });
  expect(tree.status).toBe(200);
  expect(await tree.json()).toMatchObject({ releaseId: US_V2_CANDIDATE });
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a US version 2 run shows the reform validation its run manifest declares under artifacts/", async () => {
  const store = serve(usV2Store());

  const body = await runDetail();

  expect(body.reform_validation).not.toBeNull();
  expect(body.reform_validation).toMatchObject({
    available: true,
    release_id: US_V2_CANDIDATE,
    updated_at: "2026-11-27T05:00:00+00:00",
    scoring_window: "FY2025-2034",
    rows: [expect.objectContaining({ id: "obbba_salt_cap", within_10pct: true })],
    summary: {
      n_reforms: 1,
      n_out_of_sample: 1,
      n_out_of_sample_scored: 1,
      out_of_sample_within_10pct: 1,
    },
  });
  expect(body.reform_validation.summary.out_of_sample_mean_abs_relative_error).toBeCloseTo(0.05);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a version 2 run shows no reform validation other than the one its run manifest declares", async () => {
  const cases: [string, RunFiles][] = [
    // The copy holds other bytes than the run manifest declares.
    ["a copy that differs", usV2RunFiles({ "artifacts/reform_validation.json": usV2ReformValidation(-50) })],
    // The run manifest declares no reform validation.
    [
      "an undeclared copy",
      usV2RunFiles({
        "run_manifest.json": usV2RunManifest({ diagnostics: diagnosticsFixture, reformValidation: null }),
      }),
    ],
    // Version 2 writes result files only under artifacts/.
    [
      "a top-level copy",
      (() => {
        const { "artifacts/reform_validation.json": declared, ...files } = usV2RunFiles();
        return { ...files, "reform_validation.json": declared };
      })(),
    ],
  ];
  for (const [label, files] of cases) {
    const store = serve(usV2Store(files));
    const body = await runDetail();
    restore?.();
    restore = null;
    clearBuildRunCaches();

    expect({ label, reform_validation: body.reform_validation }).toEqual({
      label,
      reform_validation: null,
    });
    expect(store.huggingFaceRequests).toEqual([]);
  }
});

test("a version 2 run without a copied run manifest shows no reform validation", async () => {
  const { "run_manifest.json": _manifest, ...files } = usV2RunFiles();
  const store = serve(usV2Store(files));

  const body = await runDetail();

  expect(body.progress).toMatchObject({ schema_version: 3, run_id: US_V2_RUN });
  expect(body.reform_validation).toBeNull();
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a version 3 run whose index summary records no version shows no top-level reform validation", async () => {
  // The collector records a run whose run manifest copy isn't a JSON object
  // as a problem, with no version in its summary; its progress and events are
  // still version 3.
  const { "artifacts/reform_validation.json": declared, ...files } = usV2RunFiles();
  const store = new FakeCollectorStore();
  store.addStagingRun({
    country: "us",
    runId: US_V2_RUN,
    files: { ...files, "run_manifest.json": "not a JSON object", "reform_validation.json": declared },
    problem: "The run manifest is not a JSON object.",
    summary: { schema_version: null },
  });
  serve(store);

  const body = await runDetail();

  expect(body.progress).toMatchObject({ schema_version: 3, run_id: US_V2_RUN });
  expect(body.reform_validation).toBeNull();
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the calibration and Build progress readers don't read a version 2 run's reform validation", async () => {
  const store = serve(usV2Store());
  const reformValidationCopy =
    store.stagingIndex("us").runs[US_V2_RUN].files["artifacts/reform_validation.json"]?.path;

  const tree = await stagingTargetTree(request(`/staging/target-tree?country=us&run=${US_V2_RUN}`));
  const builds = await loadBuildRuns("staging", "us");

  expect(reformValidationCopy).toBeString();
  expect(tree.status).toBe(200);
  expect(builds.runs.map((run) => run.run_id)).toEqual([US_V2_RUN]);
  expect(store.requests).not.toContain(reformValidationCopy);
});

test("a US version 1 run still shows its top-level reform validation", async () => {
  const runId = "populace-us-2026-v1-run-20261020T010000Z";
  const candidate = "populace-us-2026-v1-candidate";
  const store = new FakeCollectorStore();
  store.addStagingRun({
    country: "us",
    runId,
    files: {
      "progress.json": {
        schema_version: 1,
        run_id: runId,
        candidate_release_id: candidate,
        status: "passed",
        stage: "complete",
        started_at: "2026-10-20T01:00:00+00:00",
        updated_at: "2026-10-20T02:00:00+00:00",
      },
      "reform_validation.json": { ...usV2ReformValidation(), release_id: candidate },
    },
  });
  serve(store);

  const body = await runDetail(runId);

  expect(body.reform_validation).toMatchObject({
    available: true,
    release_id: candidate,
    summary: { n_reforms: 1, out_of_sample_within_10pct: 1 },
  });
  expect(store.huggingFaceRequests).toEqual([]);
});
