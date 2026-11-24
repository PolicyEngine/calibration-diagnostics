// The release and staging calibration views read the collector's calibration
// tree store, never Hugging Face. Each test runs a route's own handler, with
// its real readers, against a fake store served to `@vercel/blob`; every
// request to Hugging Face is recorded and fails.
import { afterEach, beforeEach, expect, test } from "bun:test";

import diagnosticsFixture from "@/lib/microcosm/fixtures/zz-release/calibration_diagnostics.json";
import releaseManifestFixture from "@/lib/microcosm/fixtures/zz-release/release_manifest.json";
import { clearBuildRunCaches, loadBuildRun, loadBuildRuns } from "@/lib/microcosm/build-runs";
import {
  FakeCollectorStore,
  fakeDocumentSha256,
} from "@/lib/microcosm/test-support/fake-collector-store";
import { loadStoredStagingTargetChangeDataset } from "@/lib/microcosm/stored-staging";
import {
  stagingDiagnosticsFixture,
  stagingRunManifest,
} from "@/lib/microcosm/test-support/staging-run-fixture";

import { GET as overview } from "./route";
import { GET as parentBuild } from "./parent-build/route";
import { GET as releases } from "./releases/route";
import { GET as compareStaging } from "./staging/compare/route";
import { GET as stagingRun } from "./staging/run/route";
import { GET as stagingRuns } from "./staging/runs/route";
import { GET as stagingTargetChangeTree } from "./staging/target-change-tree/route";
import { GET as stagingTargetTree } from "./staging/target-tree/route";
import { GET as targetDiagnostics } from "./target-diagnostics/route";
import { GET as targetInvestigation } from "./target-investigation/route";

const COLLECTOR_SETTINGS = [
  "MICROCOSM_TELEMETRY_COLLECTOR_URL",
  "MICROCOSM_BUILD_MONITOR_COLLECTOR_ONLY",
] as const;
const originalCollectorSettings = Object.fromEntries(
  COLLECTOR_SETTINGS.map((name) => [name, process.env[name]]),
);

// A US release build in its own folder, named by releases.json. Each test
// uses its own country and IDs where caches could carry an answer over.
const US_RELEASE = "populace-us-2026-store";
const US_BUILD = "populace-us-2026-store-b1-20261020T000000Z";
const US_RELEASE_ID = `${US_RELEASE}/${US_BUILD}`;
const US_BUILD_MANIFEST = {
  schema_version: 1,
  build_id: US_BUILD,
  gates: { target_compilation: { status: "passed", dropped_target_names: [] } },
};
const US_RELEASES_RECORD = {
  schema_version: 1,
  default: US_RELEASE,
  releases: {
    [US_RELEASE]: {
      role: "national",
      current: US_BUILD,
      builds: { [US_BUILD]: { published_at: "2026-10-20T00:00:00Z", withdrawn: false } },
    },
  },
};
const PARENT_BUILD_MANIFEST = {
  build_id: "populace-us-2026-parent-20261019T000000Z",
  staging: { enabled: true, run_id: "populace-us-build-20261019T000000Z-1a2b3c4d" },
};

// A US staging run whose calibration diagnostics were uploaded with its
// telemetry (a schema 1 run reads `runs/<id>/calibration_diagnostics.json`).
const US_RUN = "populace-us-2026-store-run-20261020T010000Z";
const US_CANDIDATE = "populace-us-2026-store-candidate";

function usRunProgress(status: string, updatedAt = "2026-10-20T02:00:00+00:00") {
  return {
    schema_version: 1,
    run_id: US_RUN,
    candidate_release_id: US_CANDIDATE,
    status,
    stage: status === "passed" ? "complete" : "calibrating",
    started_at: "2026-10-20T01:00:00+00:00",
    updated_at: updatedAt,
  };
}

const US_RUN_MANIFEST = {
  schema_version: 1,
  run_id: US_RUN,
  candidate_release_id: US_CANDIDATE,
  pipeline: { id: "us_fiscal_refresh", version: "2026.10" },
  artifacts: {
    calibration_diagnostics: {
      path: "calibration_diagnostics.json",
      staging_path: `runs/${US_RUN}/calibration_diagnostics.json`,
    },
  },
};

const US_EVENTS = [
  { time: "2026-10-20T01:00:00+00:00", stage: "start", status: "running", message: "started" },
  { time: "2026-10-20T01:30:00+00:00", stage: "calibrating", status: "running", message: "fit" },
]
  .map((event) => JSON.stringify(event))
  .join("\n");

const US_CALIBRATION_PROGRESS = {
  schema_version: 1,
  run_id: US_RUN,
  events: [
    { time: "2026-10-20T01:40:00+00:00", epoch: 10, epochs: 100, loss: 0.5 },
    { time: "2026-10-20T01:50:00+00:00", epoch: 20, epochs: 100, loss: 0.25 },
  ],
};

function usStore(runStatus = "passed"): FakeCollectorStore {
  const store = new FakeCollectorStore();
  store.addBuild({
    country: "us",
    kind: "release",
    releaseId: US_RELEASE_ID,
    latest: true,
    files: {
      calibrationDiagnostics: diagnosticsFixture,
      buildManifest: US_BUILD_MANIFEST,
      releaseManifest: releaseManifestFixture,
      demographics: { households: 2500 },
      parentBuildManifest: PARENT_BUILD_MANIFEST,
    },
  });
  store.addReleasesRecord("us", US_RELEASES_RECORD);
  store.addBuild({
    country: "us",
    kind: "staging",
    stagingRunId: US_RUN,
    label: US_CANDIDATE,
    hfRepo: "policyengine/populace-us-staging",
    files: { calibrationDiagnostics: diagnosticsFixture },
  });
  store.addStagingRun({
    country: "us",
    runId: US_RUN,
    files: {
      "progress.json": usRunProgress(runStatus),
      "run_manifest.json": US_RUN_MANIFEST,
      "events.ndjson": US_EVENTS,
      "calibration_progress.json": US_CALIBRATION_PROGRESS,
    },
  });
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

test("the Overview page reads the latest release's original files from the store", async () => {
  const store = serve(usStore());

  const response = await overview(request("?country=us"));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    release_id: US_RELEASE_ID,
    revision: store.manifest.countries.us!.builds[0].hfCommitSha,
    source: "huggingface_immutable",
    build_manifest: US_BUILD_MANIFEST,
    release_manifest: releaseManifestFixture,
    gates: US_BUILD_MANIFEST.gates,
    calibration: { final_loss: 0.0125, n_records: 2500 },
  });
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the Targets page and the target investigation read the store", async () => {
  const store = serve(usStore());
  const query = `?country=us&release=${encodeURIComponent(US_RELEASE_ID)}`;

  const targets = await targetDiagnostics(request(`/target-diagnostics${query}`));
  const investigation = await targetInvestigation(request(`/target-investigation${query}`));

  expect(targets.status).toBe(200);
  expect((await targets.json()).release_id).toBe(US_RELEASE_ID);
  expect(investigation.status).toBe(200);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a release whose diagnostics the store has no copy of is unavailable, without asking Hugging Face", async () => {
  const store = new FakeCollectorStore();
  store.addBuild({
    country: "uk",
    kind: "release",
    releaseId: "microcosm-uk-2026-uncopied-20261020T000000Z",
    latest: true,
    files: { buildManifest: { schema_version: 1 } },
  });
  serve(store);

  const response = await overview(request("?country=uk"));

  expect(response.status).toBe(502);
  expect((await response.json()).detail).toContain("calibration_diagnostics.json");
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a build without an update time has none, rather than one read from Hugging Face", async () => {
  const store = new FakeCollectorStore();
  store.addBuild({
    country: "uk",
    kind: "release",
    releaseId: "microcosm-uk-2024-25-undated",
    latest: true,
    updatedAt: null,
    files: { calibrationDiagnostics: diagnosticsFixture },
  });
  serve(store);

  const response = await overview(request("?country=uk"));

  expect(response.status).toBe(200);
  expect((await response.json()).updated_at ?? null).toBeNull();
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the release list comes from the stored releases.json", async () => {
  const store = serve(usStore());

  const response = await releases(request("/releases?country=us"));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.latest_release_id).toBe(US_RELEASE_ID);
  expect(body.all_releases).toEqual([
    expect.objectContaining({
      release_id: US_RELEASE_ID,
      release: US_RELEASE,
      build: US_BUILD,
      has_calibration: true,
      withdrawn: false,
    }),
  ]);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a country whose stored copy says it has no releases.json lists the manifest's release builds", async () => {
  const store = new FakeCollectorStore();
  const older = "microcosm-be-2025-store-a1b2c3d-20260823T134247Z";
  const newer = "microcosm-be-2026-store-b2c3d4e-20260823T204826Z";
  store.addBuild({
    country: "be",
    kind: "release",
    releaseId: older,
    files: {
      calibrationDiagnostics: diagnosticsFixture,
      releaseManifest: { dataset_role: "non_default_local_area" },
    },
  });
  store.addBuild({
    country: "be",
    kind: "release",
    releaseId: newer,
    latest: true,
    files: { calibrationDiagnostics: diagnosticsFixture, releaseManifest: releaseManifestFixture },
  });
  store.addReleasesRecord("be", null);
  serve(store);

  const response = await releases(request("/releases?country=be"));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.latest_release_id).toBe(newer);
  expect(body.all_releases).toEqual([
    expect.objectContaining({
      release_id: newer,
      date: "20260823T204826Z",
      files: [],
      has_calibration: true,
      is_default: true,
      is_local_area: false,
    }),
    expect.objectContaining({
      release_id: older,
      date: "20260823T134247Z",
      dataset_role: "non_default_local_area",
      is_default: false,
      is_local_area: true,
    }),
  ]);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a country the store has no releases.json copy for yet fails the release list", async () => {
  const store = new FakeCollectorStore();
  store.addBuild({
    country: "uk",
    kind: "release",
    releaseId: "microcosm-uk-2026-norecord-20261020T000000Z",
    latest: true,
    files: { calibrationDiagnostics: diagnosticsFixture },
  });
  serve(store);

  const response = await releases(request("/releases?country=uk"));

  expect(response.status).toBe(502);
  expect((await response.json()).detail).toContain("releases.json");
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the inherited-calibration label reads the build's stored parent build manifest", async () => {
  const store = serve(usStore());

  const response = await parentBuild(
    request(`/parent-build?country=us&release=${encodeURIComponent(US_RELEASE_ID)}`),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    release_id: US_RELEASE_ID,
    parent_build_id: PARENT_BUILD_MANIFEST.build_id,
    staging_run_id: PARENT_BUILD_MANIFEST.staging.run_id,
  });
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the Candidate tab lists the copied staging runs", async () => {
  const store = serve(usStore());

  const response = await stagingRuns(request("/staging/runs?country=us"));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    available: true,
    source_repo: "policyengine/populace-us-staging",
    revision: "main",
    truncated: false,
    incompatible_runs: [],
  });
  expect(body.runs).toEqual([
    expect.objectContaining({
      run_id: US_RUN,
      candidate_release_id: US_CANDIDATE,
      status: "passed",
      state_source: "hugging_face",
    }),
  ]);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a copied run removed from Hugging Face leaves the Candidate list", async () => {
  const store = usStore();
  store.addStagingRun({
    country: "us",
    runId: "populace-us-2026-removed-run",
    removed: true,
    files: {
      "progress.json": { ...usRunProgress("failed"), run_id: "populace-us-2026-removed-run" },
    },
  });
  serve(store);

  const response = await stagingRuns(request("/staging/runs?country=us"));

  expect((await response.json()).runs.map((run: { run_id: string }) => run.run_id)).toEqual([
    US_RUN,
  ]);
});

test("a Candidate tab run reads its copied files and its stored calibration", async () => {
  const store = serve(usStore());

  const response = await stagingRun(request(`/staging/run?country=us&id=${US_RUN}`));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({
    available: true,
    source_repo: "policyengine/populace-us-staging",
    revision: "main",
    run_id: US_RUN,
    candidate_release_id: US_CANDIDATE,
    schema_version: 1,
    progress: { status: "passed", candidate_release_id: US_CANDIDATE },
    run_manifest: { artifacts: US_RUN_MANIFEST.artifacts },
    calibration_progress: { events: US_CALIBRATION_PROGRESS.events },
    has_calibration: true,
    calibration: {
      source: "huggingface_live",
      release_id: US_CANDIDATE,
      final_loss: 0.0125,
    },
    state: { state_source: "hugging_face", status: "passed" },
  });
  expect(body.events.map((event: { stage: string }) => event.stage)).toEqual([
    "start",
    "calibrating",
  ]);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a run the store has no copy of has no documents and no calibration", async () => {
  const store = serve(usStore());

  const response = await stagingRun(request("/staging/run?country=us&id=populace-us-2026-unknown"));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    available: true,
    run_id: "populace-us-2026-unknown",
    progress: null,
    run_manifest: null,
    events: [],
    has_calibration: false,
    calibration: null,
  });
  expect(store.huggingFaceRequests).toEqual([]);
});

// A UK run that staged its dataset bundle: its run manifest declares the
// bundle's receipt, and the receipt the bundle's diagnostics.
function stagedBundleRun(
  runId: string,
  diagnosticsSha256: string,
  status = "uploaded",
  repository = "policyengine/populace-uk-private",
) {
  const receipt = {
    status,
    run_id: runId,
    repository,
    prefix: `staged/${runId}`,
    revision: "a".repeat(40),
    files: { "calibration_diagnostics.json": { sha256: diagnosticsSha256 } },
  };
  const manifest = {
    ...stagingRunManifest(runId, null),
    artifacts: [
      {
        logical_name: "staged_dataset",
        artifact_kind: "sampling_receipt",
        contract_relative_path: "artifacts/staged_dataset.json",
        media_type: "application/json",
        sha256: fakeDocumentSha256(receipt),
        classification: "aggregate",
      },
    ],
  };
  return { "run_manifest.json": manifest, "artifacts/staged_dataset.json": receipt };
}

function ukStagingStore(
  runId: string,
  runFiles: Parameters<FakeCollectorStore["addStagingRun"]>[0]["files"] | null,
  options: { removed?: boolean } = {},
): FakeCollectorStore {
  const store = new FakeCollectorStore();
  store.addBuild({
    country: "uk",
    kind: "staging",
    stagingRunId: runId,
    label: `${runId}-candidate`,
    files: { calibrationDiagnostics: stagingDiagnosticsFixture() },
  });
  if (runFiles) store.addStagingRun({ country: "uk", runId, files: runFiles, ...options });
  else store.addStagingRun({ country: "uk", runId: `${runId}-other`, files: {} });
  return store;
}

async function runCalibration(runId: string) {
  const response = await stagingRun(request(`/staging/run?country=uk&id=${runId}`));
  expect(response.status).toBe(200);
  const body = await response.json();
  return { has_calibration: body.has_calibration, source: body.calibration?.source ?? null };
}

test("a staged bundle run's calibration names its staged bundle as the source", async () => {
  const runId = "uk-store-staged-run";
  const store = serve(
    ukStagingStore(runId, stagedBundleRun(runId, fakeDocumentSha256(stagingDiagnosticsFixture()))),
  );

  expect(await runCalibration(runId)).toEqual({
    has_calibration: true,
    source: "huggingface_staged_bundle",
  });
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a run's calibration needs the tree to hold the diagnostics its files declare", async () => {
  const diagnosticsSha256 = fakeDocumentSha256(stagingDiagnosticsFixture());
  const otherSha256 = "b".repeat(64);
  const cases: [string, Parameters<FakeCollectorStore["addStagingRun"]>[0]["files"], boolean][] = [
    ["uk-store-declared", { "run_manifest.json": stagingRunManifest("uk-store-declared", diagnosticsSha256) }, true],
    // The tree was built from earlier diagnostics than the run now declares.
    ["uk-store-newer", { "run_manifest.json": stagingRunManifest("uk-store-newer", otherSha256) }, false],
    ["uk-store-bundle-newer", stagedBundleRun("uk-store-bundle-newer", otherSha256), false],
    // A staging that failed lands no bundle.
    ["uk-store-bundle-failed", stagedBundleRun("uk-store-bundle-failed", diagnosticsSha256, "failed"), false],
    // Bundles are read only from the country's registered release repository.
    [
      "uk-store-bundle-elsewhere",
      stagedBundleRun("uk-store-bundle-elsewhere", diagnosticsSha256, "uploaded", "someone/else"),
      false,
    ],
  ];
  for (const [runId, files, shown] of cases) {
    const store = serve(ukStagingStore(runId, files));
    const calibration = await runCalibration(runId);
    restore?.();
    restore = null;

    expect({ runId, shown: calibration.has_calibration }).toEqual({ runId, shown });
    expect(store.huggingFaceRequests).toEqual([]);
  }
});

test("a run with a stored tree but no current copy of its files has no calibration", async () => {
  const runId = "uk-store-uncopied";
  for (const store of [
    ukStagingStore(runId, null),
    ukStagingStore(
      runId,
      { "run_manifest.json": stagingRunManifest(runId, fakeDocumentSha256(stagingDiagnosticsFixture())) },
      { removed: true },
    ),
  ]) {
    serve(store);
    const calibration = await runCalibration(runId);
    const tree = await stagingTargetTree(request(`/staging/target-tree?country=uk&run=${runId}`));
    restore?.();
    restore = null;

    expect(calibration.has_calibration).toBe(false);
    expect(tree.status).toBe(404);
  }
});

test("a finished run's target changes follow a replaced tree", async () => {
  const store = usStore();
  serve(store);
  const before = await loadStoredStagingTargetChangeDataset(US_RUN, US_RELEASE_ID, "us");
  store.addBuild({
    country: "us",
    kind: "staging",
    stagingRunId: US_RUN,
    label: US_CANDIDATE,
    variant: "rebuilt",
    replaceStagingRun: true,
    files: { calibrationDiagnostics: { ...diagnosticsFixture, n_records: 2501 } },
  });

  const after = await loadStoredStagingTargetChangeDataset(US_RUN, US_RELEASE_ID, "us");

  expect(before?.candidate.calibrationProvenance).not.toEqual(after?.candidate.calibrationProvenance);
});

test("a run's target changes follow a changed declaration under the same tree", async () => {
  const runId = "uk-store-redeclared";
  const diagnosticsSha256 = fakeDocumentSha256(stagingDiagnosticsFixture());
  const store = ukStagingStore(runId, {
    "run_manifest.json": stagingRunManifest(runId, diagnosticsSha256),
  });
  store.addBuild({
    country: "uk",
    kind: "release",
    releaseId: "microcosm-uk-2026-redeclared-20261020T000000Z",
    latest: true,
    files: { calibrationDiagnostics: stagingDiagnosticsFixture() },
  });
  serve(store);
  const release = "microcosm-uk-2026-redeclared-20261020T000000Z";
  const before = await loadStoredStagingTargetChangeDataset(runId, release, "uk");
  // The run now declares other diagnostics than its tree holds.
  store.addStagingRun({
    country: "uk",
    runId,
    files: { "run_manifest.json": stagingRunManifest(runId, "b".repeat(64)) },
  });

  const after = await loadStoredStagingTargetChangeDataset(runId, release, "uk");

  expect(before).not.toBeNull();
  expect(after).toBeNull();
});

test("a store without the country's staging run copies says so", async () => {
  const store = new FakeCollectorStore();
  serve(store);

  const runs = await stagingRuns(request("/staging/runs?country=uk"));
  const run = await stagingRun(request("/staging/run?country=uk&id=uk-store-anything"));
  const builds = await loadBuildRuns("staging", "uk");

  expect(runs.status).toBe(200);
  expect(await runs.json()).toMatchObject({ available: false, runs: [] });
  expect(await run.json()).toMatchObject({ available: false, has_calibration: false });
  expect(builds.problems.map((problem) => problem.run_id)).toEqual(["hugging-face-history"]);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the staging target tree is built from the run's stored diagnostics", async () => {
  const store = serve(usStore());

  const response = await stagingTargetTree(
    request(`/staging/target-tree?country=us&run=${US_RUN}`),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ releaseId: US_CANDIDATE });
  expect(store.huggingFaceRequests).toEqual([]);
});

test("a run without a stored tree has no staging target tree", async () => {
  const store = usStore();
  store.addStagingRun({
    country: "us",
    runId: "populace-us-2026-treeless",
    files: { "progress.json": { ...usRunProgress("running"), run_id: "populace-us-2026-treeless" } },
  });
  serve(store);

  const response = await stagingTargetTree(
    request("/staging/target-tree?country=us&run=populace-us-2026-treeless"),
  );

  expect(response.status).toBe(404);
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the staging comparison compares the stored candidate with the stored release", async () => {
  const store = serve(usStore());

  const response = await compareStaging(
    request(`/staging/compare?country=us&run=${US_RUN}`),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ available: true, run_id: US_RUN });
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the target-change tree compares the stored candidate with a stored release", async () => {
  const store = serve(usStore());

  const response = await stagingTargetChangeTree(
    request(
      `/staging/target-change-tree?country=us&run=${US_RUN}&release=${encodeURIComponent(US_RELEASE_ID)}`,
    ),
  );

  expect(response.status).toBe(200);
  // The fixtures carry no loss attribution, so the tree says so; the run's
  // stored diagnostics were found.
  expect((await response.json()).reason).not.toBe(
    "This staging run has not uploaded calibration diagnostics yet.",
  );
  expect(store.huggingFaceRequests).toEqual([]);
});

test("the Build progress tab reads the copied run files when Hugging Face run files are on", async () => {
  const store = serve(usStore("running"));

  const list = await loadBuildRuns("staging", "us");
  const detail = await loadBuildRun("staging", "us", US_RUN).catch((error: unknown) => error);

  expect(list.available).toBe(true);
  expect(list.problems).toEqual([]);
  expect(list.runs.map((run) => run.run_id)).toEqual([US_RUN]);
  expect(detail).toMatchObject({ run: { run_id: US_RUN } });
  expect(store.huggingFaceRequests).toEqual([]);
});
