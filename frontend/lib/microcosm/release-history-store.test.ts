import { expect, test } from "bun:test";

import {
  buildTimeline,
  encodeDocument,
  finalizeCountry,
  memoryStore,
  planPanel,
  putImmutable,
  putWriteOnce,
  readJson,
  RELEASE_HISTORY_MANIFEST_PATH,
  seriesMatches,
  storedFileKind,
  updateManifestCountry,
  WriteConflict,
  type ManifestCountry,
  type MeasurementDocument,
  type ReleaseBuild,
  type ReleaseHistoryManifest,
  type ReleaseHistoryStore,
} from "./release-history-store";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const PANEL = "p".repeat(64);

function build(id: string, overrides: Partial<ReleaseBuild> = {}): ReleaseBuild {
  return {
    releaseId: id,
    releaseDirectory: "line",
    hfRepo: "policyengine/zz",
    hfCommitSha: COMMIT,
    publishedAt: `2026-11-0${id.slice(-1)}T00:00:00Z`,
    current: false,
    withdrawn: false,
    ...overrides,
  };
}

function measurement(
  id: string,
  releaseId: string,
  publishedAt: string,
  cells: MeasurementDocument["cells"],
  status = "ok",
): MeasurementDocument {
  return {
    measurement_id: id,
    status,
    point: {
      release_id: releaseId,
      release_directory: "line",
      hf_repo: "policyengine/zz",
      hf_commit: COMMIT,
      published_at: publishedAt,
    },
    cells,
  };
}

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

test("series match the Python spec's rule", () => {
  const series = { releases: ["zz-national", "^zz-2024-"], exclude: ["acs-local"] };
  expect(seriesMatches(series, "zz-national")).toBe(true);
  expect(seriesMatches(series, "zz-national/uk-frs-calibration-attempt-1")).toBe(true);
  expect(seriesMatches(series, "zz-national-dense")).toBe(false);
  expect(seriesMatches(series, "zz-2024-x")).toBe(true);
  expect(seriesMatches(series, "zz-2024-acs-local-1")).toBe(false);
  // A pattern on a build's release id drops that build alone.
  const one = { releases: ["zz-national"], exclude: ["-5c6b3f68$"] };
  expect(seriesMatches(one, "zz-national", "zz-national-20261002T230158Z-5c6b3f68")).toBe(false);
  expect(seriesMatches(one, "zz-national", "zz-national-20261019T083323Z-6cba5d71")).toBe(true);
  expect(seriesMatches(one, "zz-national/uk-frs-calibration-attempt-20261002T230158Z-5c6b3f68")).toBe(false);
});

test("stored file kinds follow their names", () => {
  expect(storedFileKind("release-history/uk/p/panel.json")).toBe("panel");
  expect(storedFileKind("release-history/uk/p/timeline.json")).toBe("timeline");
  expect(storedFileKind(`release-history/uk/p/${"a".repeat(64)}.json`)).toBe("measurement");
  expect(storedFileKind("release-history/uk/p/notes.json")).toBeNull();
});

test("a weekly top-up waits for a new panel's backfill; a backfill measures every missing point", () => {
  const builds = [build("b1"), build("b2"), build("b3", { withdrawn: true })];
  const current: ManifestCountry = { pinnedPanelId: "old", currentPanelId: "old", panels: {} };
  const waiting = planPanel({ country: "uk", panelId: PANEL, mode: "topup", builds, entry: current });
  expect(waiting).toMatchObject({ action: "skip", reason: "pinned_panel_awaits_backfill", seriesSize: 2 });
  const backfill = planPanel({ country: "uk", panelId: PANEL, mode: "backfill", builds, entry: current });
  expect(backfill.action).toBe("measure");
  expect(backfill.points.map((p) => p.release_id)).toEqual(["b1", "b2"]);
  expect(backfill.points[0]).toMatchObject({ hf_repo: "policyengine/zz", hf_commit: COMMIT, release_directory: "line" });
});

test("a top-up on the current panel measures only builds it lacks", () => {
  const entry = finalizeCountry({
    entry: undefined,
    panel: { panelId: PANEL, createdAt: "t", engine: {}, specSha256: "s", producerVersion: "1" },
    builds: [build("b1")],
    planned: [],
    stored: [measurement("m1", "b1", "2026-11-01T00:00:00Z", [])],
  });
  expect(entry.currentPanelId).toBe(PANEL);
  expect(entry.panels[PANEL].points.b1).toMatchObject({ measurementId: "m1", measurementStatus: "ok" });
  const plan = planPanel({ country: "uk", panelId: PANEL, mode: "topup", builds: [build("b1"), build("b2")], entry });
  expect(plan.points.map((p) => p.release_id)).toEqual(["b2"]);
  const single = planPanel({ country: "uk", panelId: PANEL, mode: "release", releaseId: "b1", builds: [build("b1")], entry });
  expect(single).toMatchObject({ action: "skip", reason: "already_measured" });
});

test("finalize counts attempts, fails a point after three, and switches current when complete", () => {
  const panel = { panelId: PANEL, createdAt: "t", engine: {}, specSha256: "s", producerVersion: "1" };
  const builds = [build("b1"), build("b2")];
  const planned = planPanel({ country: "uk", panelId: PANEL, mode: "backfill", builds, entry: undefined }).points;
  let entry = finalizeCountry({
    entry: undefined, panel, builds, planned,
    stored: [measurement("m1", "b1", "2026-11-01T00:00:00Z", [])],
  });
  expect(entry.panels[PANEL].points.b2).toMatchObject({ state: "pending", attempts: 1 });
  expect(entry.currentPanelId).toBeNull();
  for (let run = 0; run < 2; run += 1) {
    entry = finalizeCountry({ entry, panel, builds, planned: [planned[1]], stored: [measurement("m1", "b1", "2026-11-01T00:00:00Z", [])] });
  }
  expect(entry.panels[PANEL].points.b2).toMatchObject({ state: "failed", attempts: 3 });
  expect(entry.panels[PANEL].complete).toBe(true);
  expect(entry.currentPanelId).toBe(PANEL);
});

test("the timeline orders releases, carries changes over gaps, and never computes a change beside a withheld cell", () => {
  const cell = (value: number | null, status = "ok") => ({ output: "baseline/tax", period: 2026, unit: "currency", value, status });
  const timeline = buildTimeline({
    country: "uk",
    panelId: PANEL,
    builtAt: "2026-11-09T00:00:00Z",
    references: {
      baseline: { tax: { status: "resolved", value: 120, sign: 1, facts: [{ period: { value: 2026 } }] } },
      reforms: { up: { status: "citation", output: "budgetary_impact", sign: -1, citation: { row: "x" } } },
    },
    points: [
      measurement("m3", "b3", "2026-11-03T00:00:00Z", [cell(null, "withheld")]),
      measurement("m1", "b1", "2026-11-01T00:00:00Z", [
        cell(100),
        { output: "reform/up/budgetary_impact", period: 2026, unit: "currency", value: -5, status: "ok" },
      ]),
      measurement("m2", "b2", "2026-11-02T00:00:00Z", [], "error"),
      measurement("m4", "b4", "2026-11-04T00:00:00Z", [cell(110)]),
    ],
  });
  expect(timeline.points.map((p) => p.releaseId)).toEqual(["b1", "b2", "b3", "b4"]);
  const tax = timeline.series.find((s) => s.output === "baseline/tax")!;
  expect(tax.values.map((v) => v.status)).toEqual(["ok", "error", "withheld", "ok"]);
  expect(tax.values[2]).toMatchObject({ comparedWith: "m1", changeStatus: "withheld", change: null });
  expect(tax.values[3]).toMatchObject({ comparedWith: "m3", changeStatus: "withheld", change: null });
  expect(tax.reference).toMatchObject({ status: "resolved", modelSignValue: 120 });
  const reform = timeline.series.find((s) => s.output === "reform/up/budgetary_impact")!;
  expect(reform.reference).toMatchObject({ status: "citation", sign: -1 });
});

test("changes are relative for money and in points for rates", () => {
  const timeline = buildTimeline({
    country: "uk",
    panelId: PANEL,
    builtAt: "t",
    references: null,
    points: [
      measurement("m1", "b1", "2026-11-01T00:00:00Z", [
        { output: "baseline/tax", period: 2026, unit: "currency", value: 200, status: "ok" },
        { output: "baseline/poverty", period: 2026, unit: "rate", value: 0.2, status: "ok" },
      ]),
      measurement("m2", "b2", "2026-11-02T00:00:00Z", [
        { output: "baseline/tax", period: 2026, unit: "currency", value: 210, status: "ok" },
        { output: "baseline/poverty", period: 2026, unit: "rate", value: 0.25, status: "ok" },
      ]),
    ],
  });
  const value = (output: string) => timeline.series.find((s) => s.output === output)!.values[1];
  expect(value("baseline/tax")).toMatchObject({ change: 10, relativeChange: 0.05, changePoints: null });
  expect(value("baseline/poverty").changePoints).toBeCloseTo(5);
});
