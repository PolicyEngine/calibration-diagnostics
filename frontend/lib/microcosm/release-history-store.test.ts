import { expect, test } from "bun:test";

import {
  attemptPath,
  buildTimeline,
  encodeDocument,
  finalizeCountry,
  memoryStore,
  planPanel,
  putImmutable,
  putWriteOnce,
  readJson,
  MAX_PLANNED_POINTS,
  RELEASE_HISTORY_MANIFEST_PATH,
  seriesAxis,
  storedFileKind,
  updateManifestCountry,
  WriteConflict,
  type AttemptReport,
  type ManifestCountry,
  type MeasurementCell,
  type MeasurementDocument,
  type PanelSummary,
  type ReleaseHistoryManifest,
  type ReleaseHistoryStore,
  type SeriesBuild,
  type SeriesRecord,
} from "./release-history-store";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const LINE = "zz-national";
const PANEL = "a".repeat(64);
const OTHER = "e".repeat(64);
const file = (n: number) => n.toString(16).padStart(64, "0");

function build(name: string, digest: string | null, overrides: Partial<SeriesBuild> = {}): SeriesBuild {
  const day = name.replace(/\D/g, "").padStart(2, "0");
  return {
    build_id: `${LINE}/${name}`,
    release: LINE,
    build: name,
    release_directory: `${LINE}/${name}`,
    published_at: `2026-11-${day}T00:00:00Z`,
    withdrawn: false,
    current: false,
    in_default_release: true,
    role: "national",
    digest,
    dataset_path: digest ? `releases/${LINE}/${name}/zz.h5` : null,
    release_manifest_sha256: "f".repeat(64),
    listing_status: digest ? "ok" : "refused",
    listing_reason: digest ? null : "release_manifest_missing",
    ...overrides,
  };
}

function series(builds: SeriesBuild[], overrides: Partial<SeriesRecord> = {}): SeriesRecord {
  return {
    format_version: 1,
    kind: "release_history.series",
    country: "zz",
    release_repo: "policyengine/zz",
    rule: { releases: [LINE], since: null },
    revision: "main",
    commit: COMMIT,
    listed_at: "2026-11-12T00:00:00Z",
    record: { present: true, sha256: "d".repeat(64), default: LINE },
    lines: [{ release: LINE, present: true, role: "national" }],
    builds,
    ...overrides,
  };
}

function point(
  digest: string,
  cells: MeasurementCell[] = [],
  status = "ok",
  panelId = PANEL,
): MeasurementDocument {
  return {
    format_version: 1,
    kind: "release_history.measurement",
    country: "zz",
    panel_id: panelId,
    measurement_id: `m${digest.slice(1)}`,
    status,
    reason: status === "refused" ? "disclosure_source_ids_missing" : null,
    file: { sha256: digest, bytes: 1 },
    cells,
  };
}

function summary(panelId: string, model = "policyengine-zz==1.0.0"): PanelSummary {
  return { panelId, engine: { model }, specSha256: "s".repeat(64), producerVersion: "1" };
}

const cell = (value: number | null, status = "ok", output = "baseline/tax", unit = "currency"): MeasurementCell => ({
  output, period: 2026, unit, value, status, reason: status === "withheld" ? "small_cell" : null,
});

test("immutable documents refuse different bytes; write-once keeps the first", async () => {
  const store = memoryStore();
  expect(await putImmutable(store, "a.json", encodeDocument({ a: 1 }))).toBe("created");
  expect(await putImmutable(store, "a.json", encodeDocument({ a: 1 }))).toBe("unchanged");
  await expect(putImmutable(store, "a.json", encodeDocument({ a: 2 }))).rejects.toThrow(
    "already exists with different content",
  );
  expect(await putWriteOnce(store, "a.json", encodeDocument({ b: 1 }))).toBe("kept");
  expect(await readJson<{ a: number }>(store, "a.json")).toEqual({ a: 1 });
});

test("manifest writes are conditional, re-merge on a lost race, and leave other countries alone", async () => {
  const inner = memoryStore();
  let raced = false;
  const racing: ReleaseHistoryStore = {
    ...inner,
    async write(path, body, mode, immutable) {
      if (!raced && path === RELEASE_HISTORY_MANIFEST_PATH && typeof mode === "object") {
        raced = true;
        // Another country's run writes first.
        const current = (await readJson<ReleaseHistoryManifest>(inner, path))!;
        current.countries.us = { pinnedPanelId: "us", currentPanelId: "us", panels: {} };
        await inner.write(path, encodeDocument(current), "replace", false);
      }
      return inner.write(path, body, mode, immutable);
    },
  };
  const entry = (pin: string): ManifestCountry => ({ pinnedPanelId: pin, currentPanelId: null, panels: {} });
  await updateManifestCountry(racing, "uk", () => entry("first"), "2026-11-09T00:00:00Z");
  const result = await updateManifestCountry(racing, "uk", () => entry("second"), "2026-11-09T00:00:01Z");
  expect(raced).toBe(true);
  expect(result.countries.uk?.pinnedPanelId).toBe("second");
  expect(result.countries.us?.pinnedPanelId).toBe("us");
});

test("a write that keeps conflicting gives up rather than overwriting", async () => {
  const store: ReleaseHistoryStore = {
    ...memoryStore(),
    async write() {
      throw new WriteConflict("always");
    },
  };
  await expect(
    updateManifestCountry(store, "uk", () => ({ pinnedPanelId: null, currentPanelId: null, panels: {} }), "t", 2),
  ).rejects.toThrow("kept changing");
});

test("stored file kinds follow where a file sits", () => {
  expect(storedFileKind("release-history/uk/series.json")).toBe("series");
  expect(storedFileKind("release-history/uk/references.json")).toBe("references");
  expect(storedFileKind("release-history/uk/labels.json")).toBe("labels");
  expect(storedFileKind(`release-history/uk/${PANEL}/panel.json`)).toBe("panel");
  expect(storedFileKind(`release-history/uk/${PANEL}/timeline.json`)).toBe("timeline");
  expect(storedFileKind(`release-history/uk/${PANEL}/${"b".repeat(64)}.json`)).toBe("measurement");
  // An attempt report has a point's name but sits in its own folder: never a measurement.
  expect(storedFileKind(attemptPath("uk", PANEL, "b".repeat(64)))).toBe("attempt");
  expect(storedFileKind(`release-history/uk/${PANEL}/attempts/notes.json`)).toBeNull();
  expect(storedFileKind(`release-history/uk/${PANEL}/other/${"b".repeat(64)}.json`)).toBeNull();
  // References and labels are the country's, never a panel's; the manifest is never uploaded.
  expect(storedFileKind(`release-history/uk/${PANEL}/references.json`)).toBeNull();
  expect(storedFileKind("release-history/manifest.json")).toBeNull();
  expect(storedFileKind("release-history/uk/p/panel.json")).toBeNull();
  expect(storedFileKind(`release-history/uk/${PANEL}/notes.json`)).toBeNull();
  expect(storedFileKind("release-history/uk/constructor")).toBeNull();
});

test("one file under two build names is one point; a replaced file under one name is a new one", () => {
  const listed = series([build("b1", file(1)), build("b2", file(1)), build("b3", file(2))]);
  const backfill = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry: undefined });
  expect(backfill.points.map((p) => [p.build_id, p.digest])).toEqual([
    [`${LINE}/b1`, file(1)],
    [`${LINE}/b3`, file(2)],
  ]);
  expect(backfill).toMatchObject({ action: "measure", seriesFiles: 2, seriesCommit: COMMIT });
  expect(backfill.points[0]).toEqual({
    build_id: `${LINE}/b1`,
    release_directory: `${LINE}/b1`,
    hf_repo: "policyengine/zz",
    hf_commit: COMMIT,
    digest: file(1),
    attempt: 1,
    last_attempt: false,
  });
  const entry = finalizeCountry({
    mode: "backfill", entry: undefined, panel: summary(PANEL), series: listed, planned: backfill.points,
    stored: [point(file(1)), point(file(2))], pin: true, at: "2026-11-12T01:00:00Z",
  });
  // b3 is republished with a new file under the same name: that file is new, so it is planned.
  const replaced = series([build("b1", file(1)), build("b2", file(1)), build("b3", file(3))]);
  const next = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: replaced, entry });
  expect(next.points.map((p) => [p.build_id, p.digest])).toEqual([[`${LINE}/b3`, file(3)]]);
  // The release mode names a build; a build sharing a measured file needs no run.
  const shared = planPanel({ country: "zz", panelId: PANEL, mode: "release", pin: true, buildId: `${LINE}/b2`, series: listed, entry });
  expect(shared).toMatchObject({ action: "skip", reason: "already_measured" });
});

test("a missing record and an empty series are skipped with their reasons", () => {
  const absent = series([], { record: { present: false, sha256: null, default: null }, lines: [] });
  expect(planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: absent, entry: undefined }))
    .toMatchObject({ action: "skip", reason: "no_releases_record", points: [] });
  expect(planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: null, entry: undefined }))
    .toMatchObject({ reason: "no_releases_record" });
  const nothing = series([build("b1", null), build("b2", file(2), { withdrawn: true })]);
  expect(planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: nothing, entry: undefined }))
    .toMatchObject({ action: "skip", reason: "empty_series", seriesFiles: 0 });
});

test("a build is planned from the record alone: no tree manifest entry is needed", () => {
  // The newest recorded build: listed with its file, so the next backfill measures it.
  const listed = series([build("b9", file(9), { current: true })]);
  const plan = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry: undefined });
  expect(plan.points.map((p) => p.build_id)).toEqual([`${LINE}/b9`]);
});

test("the release mode refuses builds it cannot or need not measure", () => {
  const listed = series([
    build("b1", file(1)),
    build("b2", null),
    build("b3", file(3), { withdrawn: true }),
    build("b4", file(4)),
  ]);
  const release = (buildId: string, entry?: ManifestCountry) =>
    planPanel({ country: "zz", panelId: PANEL, mode: "release", pin: true, buildId, series: listed, entry });
  expect(release("elsewhere/b1")).toMatchObject({ action: "skip", reason: "release_not_in_series" });
  expect(release(`${LINE}/b2`)).toMatchObject({ action: "skip", reason: "release_manifest_missing" });
  expect(release(`${LINE}/b3`)).toMatchObject({ action: "skip", reason: "release_withdrawn" });
  expect(release(`${LINE}/b4`).points.map((p) => p.digest)).toEqual([file(4)]);
  let entry: ManifestCountry | undefined;
  for (let run = 1; run <= 3; run += 1) {
    const planned = release(`${LINE}/b4`, entry).points;
    expect(planned[0]).toMatchObject({ attempt: run, last_attempt: run === 3 });
    entry = finalizeCountry({ mode: "backfill", entry, panel: summary(PANEL), series: listed, planned, stored: [], pin: false, at: `t${run}` });
  }
  expect(entry!.panels[PANEL].points[file(4)]).toMatchObject({ state: "failed", attempts: 3 });
  expect(release(`${LINE}/b4`, entry)).toMatchObject({ action: "skip", reason: "release_failed" });
});

test("a country's first panel waits for its backfill, and only a backfill pins it", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2))]);
  const topup = (entry?: ManifestCountry) =>
    planPanel({ country: "zz", panelId: PANEL, mode: "topup", pin: true, series: listed, entry });
  expect(topup()).toMatchObject({ action: "skip", reason: "first_panel_awaits_backfill" });
  // A skipped top-up's finalize pins nothing.
  let entry = finalizeCountry({ mode: "topup", entry: undefined, panel: summary(PANEL), series: listed, planned: [], stored: [], pin: true, at: "t1" });
  expect(entry).toMatchObject({ pinnedPanelId: null, currentPanelId: null });
  expect(entry.panels[PANEL].pinnedAt).toBeNull();
  // One release measured on the default branch: held, but still no series, so still no pin.
  const one = planPanel({ country: "zz", panelId: PANEL, mode: "release", pin: true, buildId: `${LINE}/b1`, series: listed, entry });
  entry = finalizeCountry({ mode: "release", entry, panel: summary(PANEL), series: listed, planned: one.points, stored: [point(file(1))], pin: true, at: "t2" });
  expect(entry.panels[PANEL].pinnedAt).toBeNull();
  expect(topup(entry)).toMatchObject({ reason: "first_panel_awaits_backfill" });
  // A top-up skipped while the panel holds a point pins nothing either.
  entry = finalizeCountry({ mode: "topup", entry, panel: summary(PANEL), series: listed, planned: [], stored: [point(file(1))], pin: true, at: "t3" });
  expect(entry.panels[PANEL].pinnedAt).toBeNull();
  // The backfill pins it, and from then on a top-up retries what the backfill left.
  const backfill = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry });
  expect(backfill.points.map((p) => p.digest)).toEqual([file(2)]);
  entry = finalizeCountry({ mode: "backfill", entry, panel: summary(PANEL), series: listed, planned: backfill.points, stored: [point(file(1))], pin: true, at: "t4" });
  expect(entry).toMatchObject({ pinnedPanelId: PANEL, currentPanelId: null });
  expect(entry.panels[PANEL].pinnedAt).toBe("t4");
  expect(topup(entry).points.map((p) => [p.digest, p.attempt])).toEqual([[file(2), 2]]);
});

test("a top-up from another ref is skipped: other engines fill their panels by backfill or release", () => {
  const listed = series([build("b1", file(1))]);
  const entry = finalizeCountry({ mode: "backfill", entry: undefined, panel: summary(PANEL), series: listed, planned: [], stored: [point(file(1))], pin: true, at: "t" });
  expect(planPanel({ country: "zz", panelId: OTHER, mode: "topup", pin: false, series: listed, entry }))
    .toMatchObject({ action: "skip", reason: "topup_only_on_the_default_branch" });
  expect(planPanel({ country: "zz", panelId: OTHER, mode: "backfill", pin: false, series: listed, entry }).points)
    .toHaveLength(1);
});

test("a point already in the store is not measured again, though the manifest lacks it", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2))]);
  const plan = planPanel({
    country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry: undefined, stored: new Set([file(1)]),
  });
  expect(plan.points.map((p) => p.digest)).toEqual([file(2)]);
});

test("a run plans at most MAX_PLANNED_POINTS files and says the rest wait", () => {
  const many = series(Array.from({ length: MAX_PLANNED_POINTS + 5 }, (_, index) =>
    build(`b${index}`, file(index + 1), { published_at: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString() })
  ));
  const plan = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: many, entry: undefined });
  expect(plan).toMatchObject({ action: "measure", reason: "truncated", seriesFiles: MAX_PLANNED_POINTS + 5 });
  expect(plan.points).toHaveLength(MAX_PLANNED_POINTS);
  expect(plan.points[0].build_id).toBe(`${LINE}/b0`);
});

test("after a new pin, a top-up measures the new builds and the last build the old engine measured", () => {
  const old = series([build("b1", file(1)), build("b2", file(2)), build("b3", file(3))]);
  let entry = finalizeCountry({
    mode: "backfill", entry: undefined, panel: summary(PANEL, "policyengine-zz==1.0.0"), series: old, planned: [],
    stored: [point(file(1)), point(file(2)), point(file(3), [], "refused")], pin: true, at: "2026-11-01T00:00:00Z",
  });
  expect(entry).toMatchObject({ pinnedPanelId: PANEL, currentPanelId: PANEL });
  expect(entry.panels[PANEL]).toMatchObject({ pinnedAt: "2026-11-01T00:00:00Z", complete: true });
  // Two new builds arrive and the default branch moves to a new engine.
  const grown = series([...old.builds, build("b4", file(4)), build("b5", file(5))]);
  const topup = planPanel({ country: "zz", panelId: OTHER, mode: "topup", pin: true, series: grown, entry });
  // b3 is a stored gap on the old engine, so the overlap is b2, the last build it measured.
  expect(topup.points.map((p) => p.build_id)).toEqual([`${LINE}/b2`, `${LINE}/b4`, `${LINE}/b5`]);
  entry = finalizeCountry({
    mode: "topup", entry, panel: summary(OTHER, "policyengine-zz==2.0.0"), series: grown, planned: topup.points,
    stored: [point(file(2), [], "ok", OTHER), point(file(4), [], "ok", OTHER), point(file(5), [], "ok", OTHER)],
    pin: true, at: "2026-11-08T00:00:00Z",
  });
  // The new engine is pinned at once; the served panel stays until the new one is complete.
  expect(entry).toMatchObject({ pinnedPanelId: OTHER, currentPanelId: PANEL });
  expect(entry.panels[OTHER]).toMatchObject({ pinnedAt: "2026-11-08T00:00:00Z", complete: false });
  // The finalize recounted the old panel against the grown series too.
  expect(entry.panels[PANEL]).toMatchObject({
    complete: false,
    coverage: { builds: 5, files: 5, measured: 2, gap: 1, retrying: 0, failed: 0, missing: 2 },
  });
  // Next week only a newer build is new: nothing either engine holds is measured again.
  const later = series([...grown.builds, build("b6", file(6))]);
  const next = planPanel({ country: "zz", panelId: OTHER, mode: "topup", pin: true, series: later, entry });
  expect(next.points.map((p) => p.build_id)).toEqual([`${LINE}/b6`]);
  // Re-pinning the pinned panel keeps its pinnedAt.
  const again = finalizeCountry({
    mode: "topup", entry, panel: summary(OTHER, "policyengine-zz==2.0.0"), series: later, planned: [], stored: [], pin: true,
    at: "2026-11-15T00:00:00Z",
  });
  expect(again.panels[OTHER].pinnedAt).toBe("2026-11-08T00:00:00Z");
});

test("finalize counts attempts, fails a file after three, and serves a panel once it is complete", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2))]);
  let entry: ManifestCountry | undefined;
  let planned = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry }).points;
  entry = finalizeCountry({ mode: "backfill", entry, panel: summary(PANEL), series: listed, planned, stored: [point(file(1))], pin: true, at: "t1" });
  expect(entry.panels[PANEL].points[file(2)]).toMatchObject({
    state: "retrying", attempts: 1, lastError: "no_measurement_written", lastBuildId: `${LINE}/b2`, measurementId: null,
  });
  expect(entry.panels[PANEL].points[file(1)]).toMatchObject({ state: "measured", attempts: 1, lastBuildId: `${LINE}/b1` });
  expect(entry).toMatchObject({ pinnedPanelId: PANEL, currentPanelId: null });
  for (const at of ["t2", "t3"]) {
    planned = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry }).points;
    expect(planned.map((p) => p.digest)).toEqual([file(2)]);
    entry = finalizeCountry({ mode: "backfill", entry, panel: summary(PANEL), series: listed, planned, stored: [point(file(1))], pin: true, at });
  }
  expect(entry.panels[PANEL].points[file(2)]).toMatchObject({ state: "failed", attempts: 3 });
  expect(entry.panels[PANEL]).toMatchObject({
    complete: true,
    coverage: { builds: 2, files: 2, measured: 1, gap: 0, retrying: 0, failed: 1, missing: 0 },
  });
  expect(entry.currentPanelId).toBe(PANEL);
  expect(planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry }))
    .toMatchObject({ action: "skip", reason: "nothing_missing" });
});

test("a run on another engine keeps its own panel and moves neither the pin nor the served panel", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2))]);
  const both = [point(file(1)), point(file(2))];
  let entry = finalizeCountry({ mode: "backfill", entry: undefined, panel: summary(PANEL), series: listed, planned: [], stored: both, pin: true, at: "t1" });
  expect(entry).toMatchObject({ pinnedPanelId: PANEL, currentPanelId: PANEL });
  // One build measured on demand on another engine: a partial panel of its own.
  const other = summary(OTHER, "policyengine-zz==2.0.0");
  const otherPoints = both.map((p) => point(p.file.sha256, [], "ok", OTHER));
  entry = finalizeCountry({ mode: "backfill", entry, panel: other, series: listed, planned: [], stored: [otherPoints[1]], pin: false, at: "t2" });
  expect(entry).toMatchObject({ pinnedPanelId: PANEL, currentPanelId: PANEL });
  expect(Object.keys(entry.panels).sort()).toEqual([PANEL, OTHER].sort());
  expect(entry.panels[OTHER]).toMatchObject({ complete: false, pinnedAt: null, engine: { model: "policyengine-zz==2.0.0" } });
  expect(Object.keys(entry.panels[OTHER].points)).toEqual([file(2)]);
  // Completing it still leaves the served panel alone until a pinning run picks it.
  entry = finalizeCountry({ mode: "backfill", entry, panel: other, series: listed, planned: [], stored: otherPoints, pin: false, at: "t3" });
  expect(entry.panels[OTHER].complete).toBe(true);
  expect(entry.currentPanelId).toBe(PANEL);
});

test("a series that lists nothing leaves every panel's coverage as it was", () => {
  const listed = series([build("b1", file(1))]);
  const entry = finalizeCountry({ mode: "backfill", entry: undefined, panel: summary(PANEL), series: listed, planned: [], stored: [point(file(1))], pin: true, at: "t1" });
  const absent = series([], { record: { present: false, sha256: null, default: null } });
  const after = finalizeCountry({ mode: "backfill", entry, panel: summary(PANEL), series: absent, planned: [], stored: [point(file(1))], pin: true, at: "t2" });
  expect(after.panels[PANEL]).toMatchObject({ complete: true, coverage: entry.panels[PANEL].coverage });
});

function timelineOf(listed: SeriesRecord, points: MeasurementDocument[], extra: Partial<Parameters<typeof buildTimeline>[0]> = {}) {
  return buildTimeline({
    country: "zz", panelId: PANEL, series: listed, points, references: null, labels: null, builtAt: "t", ...extra,
  });
}

test("the timeline takes its order and dates from the series record, so a corrected date needs no run", () => {
  const points = [point(file(1), [cell(100)]), point(file(2), [cell(110)])];
  const first = timelineOf(series([build("b1", file(1)), build("b2", file(2))]), points);
  expect(first.builds.map((b) => b.buildId)).toEqual([`${LINE}/b1`, `${LINE}/b2`]);
  expect(first.outputs[0].values[1]).toMatchObject({ comparedWith: `${LINE}/b1`, change: 10, relativeChange: 0.1 });
  // b1's publish time is corrected to after b2's: the same points, re-ordered.
  const corrected = timelineOf(
    series([build("b1", file(1), { published_at: "2026-11-20T00:00:00Z" }), build("b2", file(2))]),
    points,
  );
  expect(corrected.builds.map((b) => b.buildId)).toEqual([`${LINE}/b2`, `${LINE}/b1`]);
  expect(corrected.builds[1].publishedAt).toBe("2026-11-20T00:00:00Z");
  expect(corrected.outputs[0].values[1]).toMatchObject({ comparedWith: `${LINE}/b2`, change: -10 });
});

test("a step joins series neighbours only; withdrawn builds and orphan points never make one", () => {
  const listed = series([
    build("b1", file(1)),
    build("b2", file(2)),
    build("b3", file(3)),
    build("b4", file(4), { withdrawn: true }),
    build("b5", file(5), { current: true }),
    build("b6", file(5)),
  ]);
  const points = [
    point(file(1), [cell(100)]),
    point(file(3), [cell(130)]),
    point(file(4), [cell(140)]),
    point(file(5), [cell(150)]),
    // A file the series no longer lists: it never plots.
    point(file(9), [cell(999), cell(1, "ok", "baseline/orphan")]),
  ];
  const states = {
    [file(2)]: {
      digest: file(2), state: "retrying" as const, measurementId: null, measurementStatus: null,
      attempts: 1, lastError: "no_measurement_written", lastStage: null, lastBuildId: `${LINE}/b2`,
    },
  };
  const timeline = timelineOf(listed, points, { states });
  expect(timeline.builds.map((b) => [b.buildId, b.state, b.withdrawn, b.sameFileAs])).toEqual([
    [`${LINE}/b1`, "measured", false, null],
    [`${LINE}/b2`, "retrying", false, null],
    [`${LINE}/b3`, "measured", false, null],
    [`${LINE}/b4`, "measured", true, null],
    [`${LINE}/b5`, "measured", false, null],
    [`${LINE}/b6`, "measured", false, `${LINE}/b5`],
  ]);
  expect(timeline.builds[1].reason).toBe("no_measurement_written");
  expect(timeline.builds[4].current).toBe(true);
  expect(timeline.outputs.map((o) => o.output)).toEqual(["baseline/tax"]);
  const values = timeline.outputs[0].values;
  expect(values.map((v) => v.status)).toEqual(["ok", "unmeasured", "ok", "ok", "ok", "ok"]);
  // b3's neighbour b2 has no value: no step across it, and none back to b1.
  expect(values[2]).toMatchObject({ comparedWith: null, change: null, changeStatus: "none" });
  // The withdrawn b4 is shown but never a neighbour: b5 steps from b3.
  expect(values[3]).toMatchObject({ comparedWith: null, changeStatus: "none" });
  expect(values[4]).toMatchObject({ comparedWith: `${LINE}/b3`, change: 20 });
  // b6 publishes b5's file again: a step of zero.
  expect(values[5]).toMatchObject({ comparedWith: `${LINE}/b5`, change: 0, changeStatus: "ok" });
  expect(JSON.stringify(timeline)).not.toContain(file(9));
});

test("a withheld cell carries its status and no reason, and no change touches it", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2)), build("b3", file(3))]);
  const timeline = timelineOf(listed, [
    point(file(1), [cell(100)]),
    point(file(2), [cell(null, "withheld")]),
    point(file(3), [cell(120)]),
  ]);
  const values = timeline.outputs[0].values;
  expect(values.map((v) => v.status)).toEqual(["ok", "withheld", "ok"]);
  expect(values[1]).toMatchObject({ value: null, comparedWith: `${LINE}/b1`, changeStatus: "withheld", change: null });
  expect(values[2]).toMatchObject({ comparedWith: `${LINE}/b2`, changeStatus: "withheld", change: null });
  for (const value of values) expect(Object.keys(value)).not.toContain("reason");
  expect(JSON.stringify(timeline)).not.toContain("small_cell");
});

test("the timeline carries the country's labels and references, and changes are relative for money and in points for rates", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2))]);
  const labels = {
    format_version: 1, kind: "release_history.labels" as const, country: "zz",
    reforms: { up: { label: "Tax up", source: null } },
  };
  const timeline = timelineOf(listed, [
    point(file(1), [cell(200), cell(0.2, "ok", "baseline/poverty", "rate"), cell(-5, "ok", "reform/up/budgetary_impact")]),
    point(file(2), [cell(210), cell(0.25, "ok", "baseline/poverty", "rate"), cell(-6, "ok", "reform/up/budgetary_impact")]),
  ], {
    labels,
    references: {
      baseline: { tax: { status: "resolved", value: 120, sign: 1, facts: [{ period: { value: 2026 } }] } },
      reforms: { up: { status: "citation", output: "budgetary_impact", sign: -1, citation: { row: "x" } } },
    },
  });
  expect(timeline.labels).toEqual(labels.reforms);
  expect(timeline.listing).toEqual({ commit: COMMIT, listedAt: "2026-11-12T00:00:00Z", rule: { releases: [LINE], since: null } });
  const output = (name: string) => timeline.outputs.find((o) => o.output === name)!;
  expect(output("baseline/tax").values[1]).toMatchObject({ change: 10, relativeChange: 0.05, changePoints: null });
  expect(output("baseline/poverty").values[1].changePoints).toBeCloseTo(5);
  expect(output("baseline/tax").reference).toMatchObject({ status: "resolved", modelSignValue: 120 });
  expect(output("reform/up/budgetary_impact").reference).toMatchObject({ status: "citation", sign: -1 });
  // A changed label reaches the next timeline from the same points.
  const renamed = timelineOf(listed, [point(file(1)), point(file(2))], {
    labels: { ...labels, reforms: { up: { label: "Basic rate +1p", source: null } } },
  });
  expect(renamed.labels.up.label).toBe("Basic rate +1p");
});

test("the axis drops builds without a file and withdrawn builds", () => {
  const listed = series([build("b1", file(1)), build("b2", null), build("b3", file(3), { withdrawn: true })]);
  expect(seriesAxis(listed).map((b) => b.build_id)).toEqual([`${LINE}/b1`]);
  expect(seriesAxis(null)).toEqual([]);
});

function report(digest: string, attempt: number, reason: string, stage = "open", status: AttemptReport["status"] = "failed"): AttemptReport {
  return {
    format_version: 1, kind: "release_history.attempt", country: "zz", panel_id: PANEL, digest,
    build_id: `${LINE}/b1`, attempt, last_attempt: attempt >= 3, status, stage, reason, error_class: null,
    at: "t",
  };
}

test("a failure is a state from the file's attempt report, charged once per planned attempt", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2)), build("b3", file(3))]);
  const plan = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry: undefined });
  const finalize = (entry: ManifestCountry | undefined, reports: Record<string, AttemptReport>, cancelled = false) =>
    finalizeCountry({
      mode: "backfill", entry, panel: summary(PANEL), series: listed, planned: plan.points,
      stored: [point(file(1))], reports, cancelled, pin: true, at: "t",
    });
  const reports = {
    [file(2)]: report(file(2), 1, "interrupted", "reform:basic_rate", "interrupted"),
    // A report left from another attempt says nothing about this one.
    [file(3)]: report(file(3), 7, "sha256_mismatch", "download"),
  };
  const once = finalize(undefined, reports);
  expect(once.panels[PANEL].points[file(2)]).toMatchObject({
    state: "retrying", attempts: 1, lastError: "interrupted", lastStage: "reform:basic_rate",
  });
  expect(once.panels[PANEL].points[file(3)]).toMatchObject({
    state: "retrying", attempts: 1, lastError: "no_measurement_written", lastStage: null,
  });
  // Finalizing the same run again (a re-run of its failed jobs) charges nothing more.
  expect(finalize(once, reports).panels[PANEL].points).toEqual(once.panels[PANEL].points);
  // A cancelled run charges only the files whose leg left a report of its attempt.
  const cancelled = finalize(undefined, reports, true);
  expect(Object.keys(cancelled.panels[PANEL].points).sort()).toEqual([file(1), file(2)].sort());
});

test("a file over the runner's budget fails at once, and retry frees it with fresh attempts", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2))]);
  const plan = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry: undefined });
  let entry = finalizeCountry({
    mode: "backfill", entry: undefined, panel: summary(PANEL), series: listed, planned: plan.points,
    stored: [point(file(1))], reports: { [file(2)]: report(file(2), 1, "exceeds_runner_budget") }, pin: true, at: "t1",
  });
  expect(entry.panels[PANEL].points[file(2)]).toMatchObject({ state: "failed", attempts: 1, lastError: "exceeds_runner_budget" });
  expect(entry.panels[PANEL].complete).toBe(true);
  // Neither a backfill nor a top-up plans a failed file again; retry does, from attempt 1.
  expect(planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry }))
    .toMatchObject({ action: "skip", reason: "nothing_missing" });
  const retry = planPanel({ country: "zz", panelId: PANEL, mode: "retry", pin: true, series: listed, entry });
  expect(retry.points.map((p) => [p.digest, p.attempt, p.last_attempt])).toEqual([[file(2), 1, false]]);
  entry = finalizeCountry({
    mode: "retry", entry, panel: summary(PANEL), series: listed, planned: retry.points,
    stored: [point(file(1)), point(file(2))], pin: true, at: "t2",
  });
  expect(entry.panels[PANEL].points[file(2)]).toMatchObject({ state: "measured", attempts: 1, lastError: null });
  expect(planPanel({ country: "zz", panelId: PANEL, mode: "retry", pin: true, series: listed, entry }))
    .toMatchObject({ action: "skip", reason: "nothing_failed" });
  expect(planPanel({ country: "zz", panelId: PANEL, mode: "retry", pin: true, buildId: `${LINE}/b2`, series: listed, entry }))
    .toMatchObject({ action: "skip", reason: "release_not_failed" });
});

test("the states tell measured, gap, retrying, failed and never run apart", () => {
  const listed = series([build("b1", file(1)), build("b2", file(2)), build("b3", file(3)), build("b4", file(4)), build("b5", file(5))]);
  const plan = planPanel({ country: "zz", panelId: PANEL, mode: "backfill", pin: true, series: listed, entry: undefined });
  const entry = finalizeCountry({
    mode: "backfill", entry: undefined, panel: summary(PANEL), series: listed,
    planned: plan.points.filter((p) => p.digest !== file(5)),
    stored: [point(file(1)), point(file(2), [], "refused")],
    reports: { [file(4)]: report(file(4), 1, "exceeds_runner_budget") }, pin: true, at: "t",
  });
  const states = (digest: string): string => entry.panels[PANEL].points[digest]?.state ?? "never run";
  expect([1, 2, 3, 4, 5].map((n) => states(file(n)))).toEqual(["measured", "gap", "retrying", "failed", "never run"]);
  expect(entry.panels[PANEL].coverage).toEqual({ builds: 5, files: 5, measured: 1, gap: 1, retrying: 1, failed: 1, missing: 1 });
  const timeline = timelineOf(listed, [point(file(1)), point(file(2), [], "refused")], { states: entry.panels[PANEL].points });
  expect(timeline.builds.map((b) => [b.state, b.reason])).toEqual([
    ["measured", null],
    ["gap", "disclosure_source_ids_missing"],
    ["retrying", "no_measurement_written"],
    ["failed", "exceeds_runner_budget"],
    ["missing", null],
  ]);
});
