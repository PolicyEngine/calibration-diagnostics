import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildTimeline, memoryStore, readJson, type ReleaseBuild, type ReleaseHistoryManifest } from "../lib/microcosm/release-history-store";
import { finalize, localTimeline, plan, pull, readLocalPanel, readStoredPanel, uploadDirectory, type PanelDocument } from "./release-history";

const PANEL_ID = "a".repeat(64);
const MEASUREMENT = "b".repeat(64);
const COMMIT = "1234567890abcdef1234567890abcdef12345678";

const panelDocument: PanelDocument = {
  panel_id: PANEL_ID,
  country: "uk",
  created_at: "2026-11-09T00:00:00Z",
  release_repo: "policyengine/populace-uk-private",
  series: { releases: ["microcosm-uk-2024-25-national"], exclude: [] },
  spec_sha256: "c".repeat(64),
  producer: { version: "1" },
  engine: {
    policyengine: "6.16.1",
    model: { name: "policyengine-uk", version: "2.174.1" },
    core: { name: "policyengine-core", version: "3.33.3" },
  },
};

const builds: ReleaseBuild[] = ["one", "two"].map((name, index) => ({
  releaseId: `microcosm-uk-2024-25-national-2026110${index + 1}T000000Z-0000000${index}`,
  releaseDirectory: "microcosm-uk-2024-25-national",
  hfRepo: "policyengine/populace-uk-private",
  hfCommitSha: COMMIT,
  publishedAt: `2026-11-0${index + 1}T00:00:00Z`,
  current: index === 1,
  withdrawn: false,
}));

async function localStore(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-history-"));
  const folder = join(root, "release-history", "uk", PANEL_ID);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "panel.json"), JSON.stringify(panelDocument));
  await writeFile(join(folder, "references.json"), JSON.stringify({ baseline: {}, reforms: {} }));
  await writeFile(join(folder, `${MEASUREMENT}.json`), JSON.stringify({
    measurement_id: MEASUREMENT,
    status: "ok",
    point: {
      release_id: builds[0].releaseId,
      release_directory: builds[0].releaseDirectory,
      hf_repo: builds[0].hfRepo,
      hf_commit: COMMIT,
      published_at: builds[0].publishedAt,
    },
    cells: [{ output: "baseline/income_tax", period: 2026, unit: "currency", value: 1, status: "ok" }],
  }));
  return root;
}

test("a run plans, uploads, and finalizes a panel; a second build stays pending", async () => {
  const root = await localStore();
  const store = memoryStore();
  expect((await readLocalPanel(root, "uk")).panel_id).toBe(PANEL_ID);

  const planned = await plan({ store, panel: panelDocument, builds, mode: "backfill" });
  expect(planned.points.map((p) => p.release_id)).toEqual(builds.map((b) => b.releaseId));

  const counts = await uploadDirectory(store, root);
  expect(counts).toEqual({ "panel:created": 1, "references:replaced": 1, "measurement:created": 1 });
  // Uploading again changes nothing that is immutable.
  expect(await uploadDirectory(store, root)).toEqual({
    "panel:kept": 1, "references:replaced": 1, "measurement:unchanged": 1,
  });

  // The finalize job reads the panel back from the store by its id.
  expect((await readStoredPanel(store, "uk", PANEL_ID)).panel_id).toBe(PANEL_ID);
  const summary = await finalize({ store, panel: panelDocument, plan: planned, at: "2026-11-09T01:00:00Z" });
  expect(summary).toMatchObject({ complete: false, current: false });
  expect(summary.points.find((p) => p.releaseId === builds[1].releaseId)).toMatchObject({ state: "pending", attempts: 1 });
  const manifest = await readJson<ReleaseHistoryManifest>(store, "release-history/manifest.json");
  expect(manifest?.countries.uk?.pinnedPanelId).toBe(PANEL_ID);
  const timeline = await readJson<{ series: unknown[]; points: unknown[] }>(store, `release-history/uk/${PANEL_ID}/timeline.json`);
  expect(timeline?.points).toHaveLength(1);
  expect(timeline?.series).toHaveLength(1);

  // A weekly top-up waits: the pinned panel is not complete yet.
  const weekly = await plan({ store, panel: panelDocument, builds, mode: "topup" });
  expect(weekly).toMatchObject({ action: "skip", reason: "pinned_panel_awaits_backfill" });

  // Pulling brings the manifest and the panel's files down.
  const out = await mkdtemp(join(tmpdir(), "release-history-pull-"));
  const pulled = await pull({ store, country: "uk", out });
  expect(pulled.panelId).toBe(PANEL_ID);
  const local = JSON.parse(await readFile(join(out, "release-history", "uk", PANEL_ID, "timeline.json"), "utf8"));
  expect(local.panelId).toBe(PANEL_ID);
});

test("a local folder builds its own timeline", async () => {
  const root = await localStore();
  const path = await localTimeline(root, "uk", PANEL_ID);
  const timeline = JSON.parse(await readFile(path, "utf8"));
  expect(timeline.series[0]).toMatchObject({ output: "baseline/income_tax", period: 2026 });
});

test("the Python producer's measurement document builds a timeline", async () => {
  // release_history/tests/test_document_fixture.py writes this file from a fake model world.
  const path = join(import.meta.dir, "..", "..", "release_history", "tests", "fixtures", "measurement.json");
  const document = JSON.parse(await readFile(path, "utf8"));
  const later = { ...document, measurement_id: "c".repeat(64), point: { ...document.point, published_at: "2026-11-02T00:00:00Z" } };
  const timeline = buildTimeline({ country: "zz", panelId: document.panel_id, points: [later, document], references: null, builtAt: "t" });
  expect(timeline.points.map((p) => p.measurementId)).toEqual([document.measurement_id, "c".repeat(64)]);
  const outputs = new Set(document.cells.map((cell: { output: string; period: number }) => `${cell.output}@${cell.period}`));
  expect(timeline.series).toHaveLength(outputs.size);
  for (const series of timeline.series) {
    const [first, second] = series.values;
    if (first.status === "withheld") {
      expect(first.value).toBeNull();
      expect(second.changeStatus).toBe("withheld");
    } else {
      expect(second.changeStatus).toBe(first.value === null ? "none" : "ok");
    }
  }
});
