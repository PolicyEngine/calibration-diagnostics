import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildTimeline,
  encodeDocument,
  memoryStore,
  readJson,
  type MeasurementDocument,
  type ReleaseHistoryManifest,
  type SeriesRecord,
  type Timeline,
} from "../lib/microcosm/release-history-store";
import {
  finalize,
  localTimeline,
  measurementIdFor,
  plan,
  pull,
  readLocalPanel,
  readLocalSeries,
  readStoredPanel,
  uploadDirectory,
  type PanelDocument,
} from "./release-history";

const FIXTURES = join(import.meta.dir, "..", "..", "release_history", "tests", "fixtures");

const PANEL_ID = "a".repeat(64);
const OTHER_PANEL = "e".repeat(64);
const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const LINE = "microcosm-uk-2024-25-national";
const FILES = ["1".repeat(64), "2".repeat(64)];

function panelDocument(panelId = PANEL_ID, version = "2.174.1"): PanelDocument {
  return {
    format_version: 1,
    kind: "release_history.panel",
    panel_id: panelId,
    panel_key: { country: "uk" },
    country: "uk",
    engine: {
      policyengine: "6.16.1",
      model: { name: "policyengine-uk", version },
      core: { name: "policyengine-core", version: "3.33.3" },
    },
    producer_version: "1",
    point_format_version: 1,
    spec_sha256: "c".repeat(64),
    definition: {},
  };
}

const series: SeriesRecord = {
  format_version: 1,
  kind: "release_history.series",
  country: "uk",
  release_repo: "policyengine/populace-uk-private",
  rule: { releases: [LINE], since: "2026-10-19" },
  revision: "main",
  commit: COMMIT,
  listed_at: "2026-11-09T00:00:00Z",
  record: { present: true, sha256: "d".repeat(64), default: LINE },
  lines: [{ release: LINE, present: true, role: "national" }],
  builds: FILES.map((digest, index) => ({
    build_id: `${LINE}/build-${index + 1}`,
    release: LINE,
    build: `build-${index + 1}`,
    release_directory: `${LINE}/build-${index + 1}`,
    published_at: `2026-11-0${index + 1}T00:00:00Z`,
    withdrawn: false,
    current: index === 1,
    in_default_release: true,
    role: "national",
    digest,
    dataset_path: `releases/${LINE}/build-${index + 1}/uk.h5`,
    release_manifest_sha256: "f".repeat(64),
    listing_status: "ok" as const,
    listing_reason: null,
  })),
};

function measurement(panelId: string, digest: string, value: number): MeasurementDocument {
  return {
    format_version: 1,
    kind: "release_history.measurement",
    country: "uk",
    panel_id: panelId,
    measurement_id: measurementIdFor(panelId, digest),
    status: "ok",
    reason: null,
    file: { sha256: digest, bytes: 1 },
    cells: [{ output: "baseline/income_tax", period: 2026, unit: "currency", value, status: "ok", reason: null }],
  };
}

/** What `identity --out` and `series --out` write, plus one measured point. */
async function localStore(panel = panelDocument()): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-history-"));
  const country = join(root, "release-history", "uk");
  const folder = join(country, panel.panel_id);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "panel.json"), JSON.stringify(panel));
  await writeFile(join(country, "series.json"), JSON.stringify(series));
  await writeFile(join(country, "references.json"), JSON.stringify({ baseline: {}, reforms: {} }));
  await writeFile(join(country, "labels.json"), JSON.stringify({
    format_version: 1, kind: "release_history.labels", country: "uk", reforms: {},
  }));
  const point = measurement(panel.panel_id, FILES[0], 1);
  await writeFile(join(folder, `${point.measurement_id}.json`), JSON.stringify(point));
  return root;
}

test("a run plans from the series record, uploads, and finalizes; an unmeasured file is retried", async () => {
  const root = await localStore();
  const store = memoryStore();
  expect((await readLocalPanel(root, "uk")).panel_id).toBe(PANEL_ID);
  const listed = await readLocalSeries(root, "uk");

  const planned = await plan({ store, panel: panelDocument(), series: listed, mode: "backfill", pin: true });
  expect(planned.points.map((p) => [p.build_id, p.digest, p.hf_commit])).toEqual([
    [`${LINE}/build-1`, FILES[0], COMMIT],
    [`${LINE}/build-2`, FILES[1], COMMIT],
  ]);
  // A first panel's top-up waits for its backfill.
  expect(await plan({ store, panel: panelDocument(), series: listed, mode: "topup", pin: true }))
    .toMatchObject({ action: "skip", reason: "first_panel_awaits_backfill" });

  const counts = await uploadDirectory(store, root, { countryFiles: true });
  expect(counts).toEqual({
    "labels:replaced": 1, "references:replaced": 1, "series:replaced": 1,
    "panel:created": 1, "measurement:created": 1,
  });
  // Uploading again changes nothing that is immutable.
  expect(await uploadDirectory(store, root, { countryFiles: true })).toEqual({
    "labels:replaced": 1, "references:replaced": 1, "series:replaced": 1,
    "panel:kept": 1, "measurement:unchanged": 1,
  });

  // The finalize job reads the panel back from the store by its id.
  expect((await readStoredPanel(store, "uk", PANEL_ID)).panel_id).toBe(PANEL_ID);
  const summary = await finalize({ store, panel: panelDocument(), plan: planned, pin: true, at: "2026-11-09T01:00:00Z" });
  expect(summary).toMatchObject({
    complete: false, current: false, pinned: true, timelines: 1,
    coverage: { builds: 2, files: 2, measured: 1, retrying: 1, missing: 0 },
  });
  expect(summary.points.find((p) => p.digest === FILES[1])).toMatchObject({
    state: "retrying", attempts: 1, buildId: `${LINE}/build-2`, lastError: "no_measurement_written",
  });
  const manifest = await readJson<ReleaseHistoryManifest>(store, "release-history/manifest.json");
  expect(manifest?.countries.uk?.pinnedPanelId).toBe(PANEL_ID);
  expect(manifest?.countries.uk?.panels[PANEL_ID].pinnedAt).toBe("2026-11-09T01:00:00Z");
  const timeline = await readJson<Timeline>(store, `release-history/uk/${PANEL_ID}/timeline.json`);
  expect(timeline?.builds.map((b) => [b.buildId, b.state])).toEqual([
    [`${LINE}/build-1`, "measured"],
    [`${LINE}/build-2`, "retrying"],
  ]);
  expect(timeline?.outputs).toHaveLength(1);

  // Pinned now, so a top-up retries the file the panel still lacks, at its second attempt.
  const weekly = await plan({ store, panel: panelDocument(), series: listed, mode: "topup", pin: true });
  expect(weekly.points.map((p) => [p.digest, p.attempt])).toEqual([[FILES[1], 2]]);
  // A run of release mode names its build as releases.json does.
  await expect(plan({ store, panel: panelDocument(), series: listed, mode: "release", pin: true, buildId: "../x" }))
    .rejects.toThrow("--build-id");

  // Pulling brings the manifest, the country's files and the panel's files down.
  const out = await mkdtemp(join(tmpdir(), "release-history-pull-"));
  const pulled = await pull({ store, country: "uk", out });
  expect(pulled).toEqual({ panelId: PANEL_ID, files: 7 });
  const local = JSON.parse(await readFile(join(out, "release-history", "uk", PANEL_ID, "timeline.json"), "utf8"));
  expect(local.panelId).toBe(PANEL_ID);
  expect(await readLocalSeries(out, "uk")).toEqual(listed);
});

test("a run that pins rebuilds every panel's timeline; a run from another ref touches only its own", async () => {
  const store = memoryStore();
  const first = await localStore();
  await uploadDirectory(store, first, { countryFiles: true });
  const pinned = await plan({ store, panel: panelDocument(), series, mode: "backfill", pin: true });
  await finalize({ store, panel: panelDocument(), plan: pinned, pin: true, at: "2026-11-09T01:00:00Z" });

  // Another engine, dispatched from a branch whose spec changed the labels: its own panel and
  // point go up, the country's files stay as the default branch wrote them.
  const other = panelDocument(OTHER_PANEL, "2.180.0");
  const second = await localStore(other);
  await writeFile(join(second, "release-history", "uk", "labels.json"), JSON.stringify({
    format_version: 1, kind: "release_history.labels", country: "uk", reforms: { r: { label: "Unmerged", source: null } },
  }));
  const counts = await uploadDirectory(store, second, { countryFiles: false });
  expect(counts).toEqual({
    "labels:held_back": 1, "references:held_back": 1, "series:held_back": 1,
    "panel:created": 1, "measurement:created": 1,
  });
  const branch = await plan({ store, panel: other, series, mode: "backfill", pin: false });
  // Its first file is already in the store: only the second is planned.
  expect(branch.points.map((p) => p.digest)).toEqual([FILES[1]]);
  const before = await readJson<Timeline>(store, `release-history/uk/${PANEL_ID}/timeline.json`);
  const summary = await finalize({ store, panel: other, plan: branch, pin: false, at: "2026-11-10T00:00:00Z" });
  expect(summary).toMatchObject({ pinned: false, current: false, timelines: 1 });
  expect(await readJson<Timeline>(store, `release-history/uk/${PANEL_ID}/timeline.json`)).toEqual(before);
  const own = await readJson<Timeline>(store, `release-history/uk/${OTHER_PANEL}/timeline.json`);
  expect(own?.labels).toEqual({});

  // The default branch lists again with a corrected publish time: every panel follows it.
  const corrected: SeriesRecord = {
    ...series,
    builds: series.builds.map((b, index) => index === 0 ? { ...b, published_at: "2026-11-05T00:00:00Z" } : b),
  };
  await store.write("release-history/uk/series.json", encodeDocument(corrected), "replace", false);
  const again = await finalize({
    store, panel: panelDocument(), plan: { ...pinned, points: [] }, pin: true, at: "2026-11-11T00:00:00Z",
  });
  expect(again).toMatchObject({ pinned: true, timelines: 2 });
  for (const panelId of [PANEL_ID, OTHER_PANEL]) {
    const timeline = await readJson<Timeline>(store, `release-history/uk/${panelId}/timeline.json`);
    expect(timeline?.builds.map((b) => b.buildId)).toEqual([`${LINE}/build-2`, `${LINE}/build-1`]);
    expect(timeline?.builtAt).toBe("2026-11-11T00:00:00Z");
  }
  const manifest = await readJson<ReleaseHistoryManifest>(store, "release-history/manifest.json");
  expect(manifest?.countries.uk).toMatchObject({ pinnedPanelId: PANEL_ID });
});

test("a local folder builds its own timeline from its series record", async () => {
  const root = await localStore();
  const path = await localTimeline(root, "uk", PANEL_ID);
  const timeline = JSON.parse(await readFile(path, "utf8")) as Timeline;
  expect(timeline.outputs[0]).toMatchObject({ output: "baseline/income_tax", period: 2026 });
  expect(timeline.builds.map((b) => b.state)).toEqual(["measured", "missing"]);
});

test("the Python producer's series record and point build the shared timeline", async () => {
  // release_history/tests/test_series.py and test_document_fixture.py write these two files from a
  // fake release repository and a fake model world.
  const listed = JSON.parse(await readFile(join(FIXTURES, "series.json"), "utf8")) as SeriesRecord;
  const document = JSON.parse(await readFile(join(FIXTURES, "measurement.json"), "utf8")) as MeasurementDocument;
  // The series' second file: the same world with every published number 10% higher.
  const secondFile = listed.builds.find((b) => b.current)!.digest!;
  // Both languages name a point alike.
  expect(measurementIdFor(document.panel_id, document.file.sha256)).toBe(document.measurement_id);
  const later: MeasurementDocument = {
    ...document,
    measurement_id: measurementIdFor(document.panel_id, secondFile),
    file: { ...document.file, sha256: secondFile },
    cells: document.cells.map((cell) => ({ ...cell, value: cell.value === null ? null : cell.value * 1.1 })),
  };
  const timeline = buildTimeline({
    country: "zz", panelId: document.panel_id, series: listed, points: [later, document],
    references: null, labels: null, builtAt: "t",
  });
  // release_history/tests/test_engine_releases_store.py reads the timeline exactly as this side
  // writes it. Regenerate with UPDATE_FIXTURES=1.
  const text = new TextDecoder().decode(encodeDocument(timeline));
  if (process.env.UPDATE_FIXTURES) await writeFile(join(FIXTURES, "timeline.json"), text);
  expect(await readFile(join(FIXTURES, "timeline.json"), "utf8")).toBe(text);
  // Four builds with a file: one file twice, a current one, a withdrawn one never measured.
  expect(timeline.builds.map((b) => [b.state, b.sameFileAs !== null, b.current, b.withdrawn])).toEqual([
    ["measured", false, false, false],
    ["measured", true, false, false],
    ["measured", false, true, false],
    ["missing", false, false, true],
  ]);
  const outputs = new Set(document.cells.map((cell) => `${cell.output}@${cell.period}`));
  expect(timeline.outputs).toHaveLength(outputs.size);
  for (const output of timeline.outputs) {
    const [first, same, current, withdrawn] = output.values;
    expect(withdrawn).toMatchObject({ status: "unmeasured", changeStatus: "none" });
    if (first.status === "withheld") {
      expect(first.value).toBeNull();
      expect(same.changeStatus).toBe("withheld");
      expect(current.changeStatus).toBe("withheld");
    } else {
      expect(same.changeStatus).toBe(first.value === null ? "none" : "ok");
      if (first.value !== null) expect(same.change).toBe(0);
    }
    for (const value of output.values) expect(Object.keys(value)).not.toContain("reason");
  }
});
