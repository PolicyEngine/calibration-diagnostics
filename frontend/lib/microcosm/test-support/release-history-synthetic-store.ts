// Test and development support: a whole release history store on synthetic values
// (calibration-diagnostics#224). No production data exists while the page is built, and the
// trial's values are never used, so this makes the cases the page must show from the producer's
// committed fixtures (each country's spec on a synthetic world) and a seeded generator, through
// the real `finalizeCountry` and `buildTimeline`:
//
// - uk: an engine bump in progress. The earlier engine's panel is the served one and lacks the
//   two newest builds; the newer engine's panel is pinned and still filling, with one file
//   retrying and one failed. One build was measured and then withdrawn, one file is published
//   under two builds, one file is a gap, the build engine and the target set change part-way,
//   and cells are withheld as in the fixture, one of them in some builds only.
// - us: one complete panel, and a second engine's panel that a run from another ref filled for
//   two builds, under another definition.
//
// Values sit near each output's public official figure where the references hold one, so the
// Relative view looks like the real thing. Every name says "synthetic".
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { measurementIdFor } from "../../../scripts/release-history";
import {
  attemptPath,
  buildTimeline,
  countryFilePath,
  encodeDocument,
  finalizeCountry,
  memoryStore,
  panelPrefix,
  updateManifestCountry,
  type AttemptReport,
  type LabelsDocument,
  type ManifestCountry,
  type MeasurementCell,
  type MeasurementDocument,
  type PanelDocument,
  type PlanMode,
  type PlannedPoint,
  type ReferencesLock,
  type ReleaseHistoryStore,
  type SeriesBuild,
  type SeriesRecord,
  type Timeline,
} from "../release-history-store";
import {
  manifestPanelSummary,
  readCountryFixture,
  RELEASE_HISTORY_FIXTURES,
  type CountryFixture,
} from "./release-history-fixture-store";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** A small seeded generator (mulberry32), so every run writes the same store. */
function seeded(seed: string): () => number {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (random: () => number, low: number, high: number) => low + (high - low) * random();

// ---------------------------------------------------------------------------
// The scenario

interface SyntheticBuild {
  /** Day and time of publication, `MMDDTHHMM`, in 2026. */
  at: string;
  /** Publishes the file of this earlier build (by index) under a new name. */
  sameFileAs?: number;
  withdrawn?: boolean;
  current?: boolean;
  /** The release repository lists it with no file to measure. */
  refused?: boolean;
  /** Its file carries no survey household ids: a stored refusal, a gap on every engine. */
  gap?: boolean;
}

interface SyntheticRun {
  panel: "earlier" | "newer" | "other";
  mode: PlanMode;
  pin: boolean;
  at: string;
  /** The builds listed when the run finalized: a later build is not on its series yet. */
  listed: number;
  /** Builds that were withdrawn only after this run. */
  notYetWithdrawn?: number[];
  /** Planned builds (by index) that stored nothing, with how their attempt ended. */
  failures?: Record<number, { reason: string; stage: string; lastAttempt?: boolean }>;
  /** The only builds the run planned; absent means every file the panel lacked. */
  only?: number[];
}

interface SyntheticCountry {
  release: string;
  releaseRepo: string;
  since: string | null;
  builds: SyntheticBuild[];
  /** The model versions of the three panels' engines. */
  engines: { earlier: string; newer?: string; other?: string };
  /** The builds (by index) from which the data build's own engine and target set change. */
  buildEngineChangesAt: number;
  targetSetChangesAt: number[];
  runs: SyntheticRun[];
}

const SCENARIOS: Record<string, SyntheticCountry> = {
  uk: {
    release: "microcosm-uk-2024-25-national",
    releaseRepo: "policyengine/populace-uk-private",
    since: "2026-10-19",
    builds: [
      { at: "1019T0833" },
      { at: "1021T0710" },
      { at: "1021T1642", sameFileAs: 1 },
      { at: "1024T0905", gap: true },
      { at: "1027T0214" },
      { at: "1029T1120", withdrawn: true },
      { at: "1102T0204" },
      { at: "1105T0204" },
      { at: "1107T0204" },
      { at: "1110T0931" },
      { at: "1112T1500", refused: true },
      { at: "1117T0204" },
      { at: "1124T0204", current: true },
    ],
    engines: { earlier: "1.0.0", newer: "1.1.0" },
    buildEngineChangesAt: 6,
    targetSetChangesAt: [6, 9],
    runs: [
      // The earlier engine's backfill, when ten builds were listed and none was withdrawn.
      { panel: "earlier", mode: "backfill", pin: true, at: "2026-11-11T05:00:00Z", listed: 10, notYetWithdrawn: [5] },
      // The engine bump's first top-up: the whole series on the new panel. One file is over the
      // runner's budget and one download failed, so the panel is not complete yet.
      {
        panel: "newer",
        mode: "topup",
        pin: true,
        at: "2026-11-25T05:00:00Z",
        listed: 13,
        failures: {
          7: { reason: "exceeds_runner_budget", stage: "open", lastAttempt: false },
          12: { reason: "download_failed", stage: "download" },
        },
      },
    ],
  },
  us: {
    release: "microcosm-us-2024-national",
    releaseRepo: "policyengine/populace-us",
    since: null,
    builds: [
      { at: "0902T1400" },
      { at: "0911T1400" },
      { at: "0915T1400", sameFileAs: 1 },
      { at: "1006T1400" },
      { at: "1020T1400" },
      { at: "1103T1400", current: true },
    ],
    engines: { earlier: "1.0.0", other: "0.9.0" },
    buildEngineChangesAt: 3,
    targetSetChangesAt: [3],
    runs: [
      { panel: "earlier", mode: "backfill", pin: true, at: "2026-11-08T05:00:00Z", listed: 6 },
      // Two builds on another engine, by hand, from a ref that pins it and edits the spec.
      { panel: "other", mode: "release", pin: false, at: "2026-11-09T12:00:00Z", listed: 6, only: [4] },
      { panel: "other", mode: "release", pin: false, at: "2026-11-09T13:00:00Z", listed: 6, only: [5] },
    ],
  },
};

function buildName(build: SyntheticBuild): string {
  return `synthetic-2026${build.at}00Z-${sha256(build.at).slice(0, 8)}`;
}

function publishedAt(build: SyntheticBuild): string {
  const [, month, day, hour, minute] = /^(\d\d)(\d\d)T(\d\d)(\d\d)$/.exec(build.at)!;
  return `2026-${month}-${day}T${hour}:${minute}:00+00:00`;
}

function fileDigest(scenario: SyntheticCountry, index: number): string {
  const build = scenario.builds[index];
  return sha256(`file:${scenario.release}:${buildName(scenario.builds[build.sameFileAs ?? index])}`);
}

function seriesRecord(
  country: string,
  scenario: SyntheticCountry,
  listed: number,
  notYetWithdrawn: readonly number[],
  listedAt: string,
): SeriesRecord {
  const builds = scenario.builds.slice(0, listed).map((build, index): SeriesBuild => {
    const name = buildName(build);
    const digest = build.refused ? null : fileDigest(scenario, index);
    return {
      build_id: `${scenario.release}/${name}`,
      release: scenario.release,
      build: name,
      release_directory: `${scenario.release}/${name}`,
      published_at: publishedAt(build),
      withdrawn: Boolean(build.withdrawn) && !notYetWithdrawn.includes(index),
      // The record's current build is the newest one listed when it was read.
      current: listed === scenario.builds.length ? Boolean(build.current) : index === listed - 1,
      in_default_release: true,
      role: "national",
      digest,
      dataset_path: digest ? `releases/${scenario.release}/${name}/national.h5` : null,
      release_manifest_sha256: digest ? sha256(`manifest:${name}`) : null,
      listing_status: digest ? "ok" : "refused",
      listing_reason: digest ? null : "release_manifest_missing",
    };
  });
  return {
    format_version: 1,
    kind: "release_history.series",
    country,
    release_repo: scenario.releaseRepo,
    rule: { releases: [scenario.release], since: scenario.since },
    revision: "main",
    commit: sha256(`series:${country}:${listed}`).slice(0, 40),
    listed_at: listedAt,
    record: { present: true, sha256: sha256(`record:${country}:${listed}`), default: scenario.release },
    lines: [{ release: scenario.release, present: true, role: "national" }],
    builds,
  };
}

// ---------------------------------------------------------------------------
// Values

interface OutputPlan {
  /** The level the series starts from. */
  base: number | null;
  /** The size of an ordinary step: a share for money and counts, an amount for rates. */
  noise: number;
  /** Whether the output takes a larger step where the data build changes. */
  jumps: boolean;
  /** What the newer and the other engine add to the earlier engine's value. */
  engineShift: Record<string, number>;
}

function outputPlan(country: string, cell: MeasurementCell, official: number | undefined): OutputPlan {
  const random = seeded(`plan:${country}:${cell.output}:${cell.period}`);
  const offset = between(random, -0.06, 0.06);
  const fallback = cell.unit === "rate" ? 0.15 : cell.unit === "ratio" ? 0.4 : 1_000_000;
  return {
    base: official !== undefined ? official * (1 + offset) : cell.value ?? fallback,
    noise: between(random, 0.001, 0.006),
    jumps: random() < 0.35,
    engineShift: { earlier: 0, newer: between(random, -0.012, 0.012), other: between(random, -0.03, 0.03) },
  };
}

/** The output's value at one build on one engine: a seeded walk from its base. */
function valueAt(
  country: string,
  cell: MeasurementCell,
  plan: OutputPlan,
  scenario: SyntheticCountry,
  fileIndex: number,
  engine: string,
): number | null {
  if (plan.base === null) return null;
  if (plan.base === 0) return 0;
  const additive = cell.unit === "rate" || cell.unit === "ratio";
  const scale = additive ? Math.max(Math.abs(plan.base), 0.05) : 1;
  let drift = 0;
  for (let step = 1; step <= fileIndex; step += 1) {
    // A build that republishes a file is that file: it takes no step of its own.
    if (scenario.builds[step].sameFileAs !== undefined || scenario.builds[step].refused) continue;
    const random = seeded(`step:${country}:${cell.output}:${cell.period}:${step}`);
    drift += between(random, -plan.noise, plan.noise);
    if (plan.jumps && scenario.targetSetChangesAt.includes(step)) drift += between(random, -0.035, 0.035);
  }
  const moved = drift + plan.engineShift[engine];
  if (!additive) return plan.base * (1 + moved);
  const value = plan.base + moved * scale;
  return cell.unit === "rate" ? Math.min(Math.max(value, 0), 1) : value;
}

// ---------------------------------------------------------------------------
// Documents

function panelDocument(fixture: CountryFixture, engine: string, version: string): PanelDocument {
  const model = `${fixture.panel.engine.model.name}==${version}`;
  // The other engine's ref also edits the spec, so its definition differs.
  const specSha256 = engine === "other" ? sha256(`spec:${fixture.panel.country}:other`) : fixture.panel.spec_sha256;
  const panelKey = { ...fixture.panel.panel_key, model, spec_sha256: specSha256 };
  return {
    ...fixture.panel,
    panel_id: sha256(JSON.stringify(panelKey)),
    panel_key: panelKey,
    engine: { ...fixture.panel.engine, model: { ...fixture.panel.engine.model, version } },
    spec_sha256: specSha256,
  };
}

function declaredFacts(
  template: MeasurementDocument,
  scenario: SyntheticCountry,
  index: number,
): MeasurementDocument["fetched_from"]["declared"] {
  const build = scenario.builds[index];
  const name = buildName(build);
  const package_ = String((template.fetched_from.declared.compatible_models as { name?: string }[] | null)?.[0]?.name ?? "policyengine");
  const builtWith = index >= scenario.buildEngineChangesAt ? "0.10.0" : "0.9.0";
  const targetSet = scenario.targetSetChangesAt.filter((change) => change <= index).length;
  return {
    build: name,
    cut_tag: null,
    migrated_from: null,
    built_at: publishedAt(build),
    built_with_model: { name: package_, version: builtWith },
    built_with_core: { name: "policyengine-core", version: "3.33.3" },
    // Most builds declare the one model version they were built with, which the reference
    // engine is outside of; the newest declare a range it is inside.
    compatible_models: [{ name: package_, specifier: index >= scenario.builds.length - 2 ? ">=1" : `==${builtWith}` }],
    reference_model_compatibility: index >= scenario.builds.length - 2 ? "inside" : "outside",
    description: null,
    build_provenance: {
      code_repository: "PolicyEngine/microcosm",
      code_commit: sha256(`commit:${name}`).slice(0, 40),
      attempt_id: name,
      target_surface_sha256: sha256(`targets:${scenario.release}:${targetSet}`),
      n_targets: 1200 + 14 * targetSet,
      target_registry_version: targetSet >= 2 ? "2026.11" : "2026.10",
      household_weight_year: 2024,
      runtime: null,
    },
  };
}

function measurement(options: {
  country: string;
  scenario: SyntheticCountry;
  fixture: CountryFixture;
  panel: PanelDocument;
  engine: string;
  index: number;
  plans: Map<string, OutputPlan>;
}): MeasurementDocument {
  const { country, scenario, fixture, panel, engine, index } = options;
  const build = scenario.builds[index];
  const measured = fixture.points.filter((point) => point.status === "ok");
  // The fixture's measured points withhold slightly different cells: builds alternate between
  // them, so a cell is withheld in some builds and published in others.
  const template = measured[index % measured.length];
  const digest = fileDigest(scenario, index);
  const name = buildName(build);
  const fetchedFrom: MeasurementDocument["fetched_from"] = {
    ...template.fetched_from,
    build_id: `${scenario.release}/${name}`,
    hf_repo: scenario.releaseRepo,
    release_manifest: {
      ...template.fetched_from.release_manifest,
      path: `releases/${scenario.release}/${name}/release_manifest.json`,
      sha256: sha256(`manifest:${name}`),
    },
    dataset: { key: "national", path: `releases/${scenario.release}/${name}/national.h5` },
    declared: declaredFacts(template, scenario, index),
  };
  const identity = {
    country,
    panel_id: panel.panel_id,
    measurement_id: measurementIdFor(panel.panel_id, digest),
    fetched_from: fetchedFrom,
    file: { sha256: digest, bytes: template.file.bytes },
  };
  if (build.gap) {
    const refused = fixture.points.find((point) => point.status === "refused") ?? template;
    return { ...refused, ...identity, status: "refused", reason: "disclosure_source_ids_missing", cells: [], data: null };
  }
  const cells = template.cells.map((cell): MeasurementCell => {
    if (cell.status === "withheld") return { ...cell, value: null };
    const plan = options.plans.get(`${cell.output}@${cell.period}`)!;
    return { ...cell, value: valueAt(country, cell, plan, scenario, index, engine) };
  });
  return {
    ...template,
    ...identity,
    status: "ok",
    reason: null,
    cells,
    data: template.data && {
      ...template.data,
      unknown_columns: index >= scenario.buildEngineChangesAt ? ["synthetic_new_column"] : [],
    },
    runtime: { ...template.runtime, near_limits: [] },
  };
}

function plannedPoint(series: SeriesRecord, build: SeriesBuild, lastAttempt: boolean): PlannedPoint {
  return {
    build_id: build.build_id,
    release_directory: build.release_directory,
    hf_repo: series.release_repo,
    hf_commit: series.commit,
    digest: build.digest as string,
    attempt: 1,
    last_attempt: lastAttempt,
  };
}

// ---------------------------------------------------------------------------
// The store

export interface SyntheticCountryStore {
  /** Panel ids by engine: `earlier` is the served panel. */
  panels: Record<string, string>;
  series: SeriesRecord;
  entry: ManifestCountry;
  timelines: Record<string, Timeline>;
  panelDocuments: Record<string, PanelDocument>;
}

export interface SyntheticReleaseHistory {
  store: ReleaseHistoryStore & { objects: Map<string, { body: Uint8Array; etag: string }> };
  countries: Record<string, SyntheticCountryStore>;
}

async function readJsonFile<T>(...parts: string[]): Promise<T> {
  return JSON.parse(await readFile(join(...parts), "utf8")) as T;
}

async function fillCountry(
  store: SyntheticReleaseHistory["store"],
  country: string,
  scenario: SyntheticCountry,
): Promise<SyntheticCountryStore> {
  const fixture = await readCountryFixture(country);
  const folder = join(RELEASE_HISTORY_FIXTURES, country);
  const labels = await readJsonFile<LabelsDocument>(folder, "labels.json");
  const references = await readJsonFile<ReferencesLock>(
    RELEASE_HISTORY_FIXTURES, "..", "..", "countries", country, "references.lock.json",
  );
  const write = (path: string, document: unknown) => store.write(path, encodeDocument(document), "replace", false);

  // Each output starts near its official figure, where the fixture's timeline carries one.
  const officials = new Map<string, number>();
  for (const output of fixture.timeline.outputs) {
    const official = output.reference?.modelSignValue;
    if (typeof official === "number") officials.set(`${output.output}@${output.period}`, official);
  }
  const plans = new Map<string, OutputPlan>();
  for (const point of fixture.points) {
    for (const cell of point.cells) {
      const key = `${cell.output}@${cell.period}`;
      if (cell.value !== null && !plans.has(key)) plans.set(key, outputPlan(country, cell, officials.get(key)));
    }
  }
  for (const point of fixture.points) {
    for (const cell of point.cells) {
      const key = `${cell.output}@${cell.period}`;
      if (!plans.has(key)) plans.set(key, outputPlan(country, cell, officials.get(key)));
    }
  }

  const panelDocuments: Record<string, PanelDocument> = {};
  for (const [engine, version] of Object.entries(scenario.engines)) {
    if (version) panelDocuments[engine] = panelDocument(fixture, engine, version);
  }
  const stored: Record<string, MeasurementDocument[]> = {};
  let series = seriesRecord(country, scenario, scenario.builds.length, [], "");
  for (const run of scenario.runs) {
    const panel = panelDocuments[run.panel];
    const prefix = panelPrefix(country, panel.panel_id);
    series = seriesRecord(country, scenario, run.listed, run.notYetWithdrawn ?? [], run.at);
    await write(`${prefix}panel.json`, panel);
    const held = new Set((stored[run.panel] ?? []).map((point) => point.file.sha256));
    const planned: PlannedPoint[] = [];
    const reports: Record<string, AttemptReport> = {};
    for (const [index, build] of series.builds.entries()) {
      if (build.digest === null || build.withdrawn || held.has(build.digest)) continue;
      if (run.only && !run.only.includes(index)) continue;
      if (planned.some((point) => point.digest === build.digest)) continue;
      const failure = run.failures?.[index];
      planned.push(plannedPoint(series, build, failure?.lastAttempt ?? false));
      if (failure) {
        reports[build.digest] = {
          format_version: 1,
          kind: "release_history.attempt",
          country,
          panel_id: panel.panel_id,
          digest: build.digest,
          build_id: build.build_id,
          attempt: 1,
          last_attempt: failure.lastAttempt ?? false,
          status: "failed",
          stage: failure.stage,
          reason: failure.reason,
          error_class: null,
          at: run.at,
          producer: { version: panel.producer_version, commit: null },
        };
        await write(attemptPath(country, panel.panel_id, build.digest), reports[build.digest]);
        continue;
      }
      const point = measurement({ country, scenario, fixture, panel, engine: run.panel, index, plans });
      (stored[run.panel] ??= []).push(point);
      await write(`${prefix}${point.measurement_id}.json`, point);
    }
    // Only a run that pins replaces the country's files.
    if (run.pin) {
      await write(countryFilePath(country, "series"), series);
      await write(countryFilePath(country, "labels"), labels);
      await write(countryFilePath(country, "references"), references);
    }
    await updateManifestCountry(store, country, (entry) =>
      finalizeCountry({
        entry,
        panel: manifestPanelSummary(panel),
        series,
        mode: run.mode,
        planned,
        stored: stored[run.panel] ?? [],
        reports,
        pin: run.pin,
        at: run.at,
      }), run.at);
  }

  // As finalize does: every panel's timeline on the series as last listed.
  const manifest = JSON.parse(new TextDecoder().decode((await store.read("release-history/manifest.json"))!.body)) as {
    countries: Record<string, ManifestCountry>;
  };
  const entry = manifest.countries[country];
  const timelines: Record<string, Timeline> = {};
  const panels: Record<string, string> = {};
  const lastRun = scenario.runs.at(-1)!;
  for (const [engine, panel] of Object.entries(panelDocuments)) {
    panels[engine] = panel.panel_id;
    const timeline = buildTimeline({
      country,
      panelId: panel.panel_id,
      series,
      points: stored[engine] ?? [],
      states: entry.panels[panel.panel_id]?.points,
      references,
      labels,
      builtAt: lastRun.at,
    });
    timelines[panel.panel_id] = timeline;
    await write(`${panelPrefix(country, panel.panel_id)}timeline.json`, timeline);
  }
  return { panels, series, entry, timelines, panelDocuments };
}

/** The synthetic store, the same on every call. */
export async function syntheticReleaseHistory(): Promise<SyntheticReleaseHistory> {
  const store = memoryStore();
  const countries: Record<string, SyntheticCountryStore> = {};
  for (const [country, scenario] of Object.entries(SCENARIOS)) {
    countries[country] = await fillCountry(store, country, scenario);
  }
  return { store, countries };
}

let shared: Promise<SyntheticReleaseHistory> | null = null;

/** One synthetic store for a whole test file: it is read, never written. */
export function sharedSyntheticReleaseHistory(): Promise<SyntheticReleaseHistory> {
  shared ??= syntheticReleaseHistory();
  return shared;
}
