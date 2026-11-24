import { afterEach, expect, test } from "bun:test";

import {
  FakeCollectorStore,
  fakeDocumentSha256,
} from "@/lib/microcosm/test-support/fake-collector-store";
import {
  stagingDiagnosticsFixture,
  stagingRunManifest,
} from "@/lib/microcosm/test-support/staging-run-fixture";

import { GET } from "./route";

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

test("builds the calibration tree from a staging run's stored diagnostics", async () => {
  const runId = "uk-fit-map";
  const diagnostics = stagingDiagnosticsFixture();
  const store = new FakeCollectorStore();
  store.addBuild({
    country: "uk",
    kind: "staging",
    stagingRunId: runId,
    label: `${runId}-candidate`,
    files: { calibrationDiagnostics: diagnostics },
  });
  store.addStagingRun({
    country: "uk",
    runId,
    files: { "run_manifest.json": stagingRunManifest(runId, fakeDocumentSha256(diagnostics)) },
  });
  restore = store.install();

  const response = await GET(
    new Request(`http://example.test/api/microcosm/staging/target-tree?run=${runId}&country=uk`),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    releaseId: `${runId}-candidate`,
    filteredMetrics: { nTargets: 1, within10Pct: 1 },
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(store.huggingFaceRequests).toEqual([]);
});

test("requires a staging run id", async () => {
  const response = await GET(new Request("http://example.test/api/microcosm/staging/target-tree?country=uk"));

  expect(response.status).toBe(400);
});
