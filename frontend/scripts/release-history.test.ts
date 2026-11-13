import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildTimeline,
  encodeDocument,
  memoryStore,
  readJson,
  type LabelsDocument,
  type MeasurementDocument,
  type ReferencesLock,
  type ReleaseHistoryManifest,
  type ReleaseHistoryStore,
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

test("attempt reports go up first, one failed file stops no other, and finalize reads the report", async () => {
  const root = await localStore();
  // The second file's leg failed at its download: its report sits in the panel's attempts folder.
  const attempts = join(root, "release-history", "uk", PANEL_ID, "attempts");
  await mkdir(attempts, { recursive: true });
  await writeFile(join(attempts, `${FILES[1]}.json`), JSON.stringify({
    format_version: 1, kind: "release_history.attempt", country: "uk", panel_id: PANEL_ID,
    digest: FILES[1], build_id: `${LINE}/build-2`, attempt: 1, last_attempt: false, status: "failed",
    stage: "download", reason: "sha256_mismatch", error_class: null, at: "2026-11-09T00:30:00Z",
    producer: { version: "1", commit: null },
  }));
  const inner = memoryStore();
  const order: string[] = [];
  const flaky: ReleaseHistoryStore = {
    ...inner,
    async write(path, body, mode, immutable) {
      order.push(path);
      if (path.endsWith("/labels.json")) throw new Error("service unavailable");
      return inner.write(path, body, mode, immutable);
    },
  };
  await expect(uploadDirectory(flaky, root, { countryFiles: true })).rejects.toThrow(
    "release-history/uk/labels.json",
  );
  expect(order[0]).toBe(`release-history/uk/${PANEL_ID}/attempts/${FILES[1]}.json`);
  for (const path of [`release-history/uk/${PANEL_ID}/panel.json`, "release-history/uk/series.json"]) {
    expect(await inner.read(path)).not.toBeNull();
  }
  // The first file's point is stored, so only the second is planned; its report is its state.
  const planned = await plan({ store: inner, panel: panelDocument(), series, mode: "backfill", pin: true });
  expect(planned.points.map((p) => p.digest)).toEqual([FILES[1]]);
  const summary = await finalize({
    store: inner, panel: panelDocument(), plan: planned, pin: true, measureResult: "failure", at: "2026-11-09T01:00:00Z",
  });
  expect(summary.points.find((p) => p.digest === FILES[1])).toMatchObject({
    state: "retrying", attempts: 1, lastError: "sha256_mismatch", lastStage: "download",
  });
  expect(summary.points.find((p) => p.digest === FILES[0])).toMatchObject({ state: "measured" });
});

test("a local folder builds its own timeline from its series record", async () => {
  const root = await localStore();
  const path = await localTimeline(root, "uk", PANEL_ID);
  const timeline = JSON.parse(await readFile(path, "utf8")) as Timeline;
  expect(timeline.outputs[0]).toMatchObject({ output: "baseline/income_tax", period: 2026 });
  expect(timeline.builds.map((b) => b.state)).toEqual(["measured", "missing"]);
});

const COUNTRY_FIXTURES = join(FIXTURES, "..", "..", "countries");

for (const country of (await readdir(FIXTURES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  test(`${country}: the producer's fixtures build the timeline the schemas check`, async () => {
    // release_history/tests/test_country_fixtures.py writes these from the country's real spec on
    // a synthetic world; the Python tests check this side's timeline against its schema.
    const folder = join(FIXTURES, country);
    const read = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;
    const panel = await read<PanelDocument>(join(folder, "panel.json"));
    const listed = await read<SeriesRecord>(join(folder, "series.json"));
    const labels = await read<LabelsDocument>(join(folder, "labels.json"));
    const references = await read<ReferencesLock>(join(COUNTRY_FIXTURES, country, "references.lock.json"));
    const points: MeasurementDocument[] = [];
    for (const name of (await readdir(join(folder, "points"))).sort()) {
      points.push(await read<MeasurementDocument>(join(folder, "points", name)));
    }
    // Both languages name a point alike.
    for (const point of points) {
      expect(measurementIdFor(point.panel_id, point.file.sha256)).toBe(point.measurement_id);
    }
    const timeline = buildTimeline({
      country, panelId: panel.panel_id, series: listed, points, references, labels, builtAt: "2026-11-12T00:00:00Z",
    });
    const text = new TextDecoder().decode(encodeDocument(timeline));
    if (process.env.UPDATE_FIXTURES) await writeFile(join(folder, "timeline.json"), text);
    expect(await readFile(join(folder, "timeline.json"), "utf8")).toBe(text);
    // One file under two builds, a current build, a withdrawn one never measured.
    expect(timeline.builds.filter((b) => b.sameFileAs !== null)).toHaveLength(1);
    expect(timeline.builds.filter((b) => b.current)).toHaveLength(1);
    expect(timeline.builds.find((b) => b.withdrawn)).toMatchObject({ state: "missing" });
    expect(timeline.labels).toEqual(labels.reforms);
    for (const output of timeline.outputs) {
      for (const value of output.values) expect(Object.keys(value)).not.toContain("reason");
    }
  });
}
