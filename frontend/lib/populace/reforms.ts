// Reform-validation data layer. Where calibration_diagnostics.json answers
// "does the dataset reproduce its calibration targets", reform_validation.json
// answers a downstream question: "does the dataset reproduce the budget effects
// of policy reforms that an authority (JCT) has officially scored?".
//
// The dashboard cannot run microsimulation, so it does not compute these — the
// populace build pipeline runs a fixed set of JCT-scored reforms on each release
// and publishes reform_validation.json alongside the other release artifacts.
// This module reads it live from Hugging Face, derives the populace-vs-JCT
// error per reform, and (across releases) tracks how that error moves
// run-over-run.
//
// ---------------------------------------------------------------------------
// reform_validation.json schema (v1) — the producer/consumer contract:
//
//   {
//     "schema_version": 1,
//     "release_id": "populace-us-2024-<sha>-...",
//     "baseline_period": 2026,
//     "scoring_window": "FY2025-2034",
//     "reforms": [
//       {
//         "id": "obbba",                       // stable across releases
//         "name": "One Big Beautiful Bill Act",
//         "category": "OBBBA",                 // grouping label
//         "description": "…",                  // optional
//         "jct": {
//           "score": -3700000000000,           // budget effect, USD (− = cost)
//           "score_type": "conventional",      // or "dynamic"
//           "window": "FY2025-2034",
//           "source": "JCX-29-25",
//           "source_url": "https://www.jct.gov/…",
//           "published": "2025-05-..."         // optional ISO date
//         },
//         "populace": {
//           "budget_effect": -3650000000000,   // populace microsim, same window
//           "window": "FY2025-2034",
//           "annual": { "2025": -1.2e11, … }   // optional per-year series
//         }
//       }
//     ]
//   }
// ---------------------------------------------------------------------------

import {
  POPULACE_HF_REPO,
  asObject,
  assertSafeReleaseId,
  hfResolveUrl,
  loadPointerReleaseId,
  loadReleases,
} from "./latest-artifact";
import { REFORM_OVERRIDES } from "./reform-overrides";

type JsonObject = Record<string, unknown>;

export const REFORM_VALIDATION_FILE = "reform_validation.json";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export interface ReformValidationRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  // in-sample reforms are JCT tax-expenditure *calibration targets* (the
  // dataset was tuned to them); out-of-sample reforms (OBBBA provisions) are
  // the genuine fidelity test.
  in_sample: boolean;
  period: number | null;
  // The JCT figure we benchmark against — JCT's first full fiscal year
  // (FY2027) for provisions effective 1/1/2026, since FY2026 is a partial ramp
  // year vs populace's calendar-year liability. In-sample rows fall back to
  // their annual figure. Error metrics below are all relative to this.
  jct_score: number | null;
  // The FY2026 figure, kept for reference (the partial ramp year).
  jct_score_fy2026: number | null;
  jct_score_type: string | null;
  jct_window: string | null;
  // The year/window the benchmark (jct_score) actually refers to — "FY2027"
  // for OBBBA rows (the full-year default), the annual window for in-sample.
  // Differs row to row, so it's shown as its own column.
  jct_benchmark_window: string | null;
  jct_source: string | null;
  jct_source_url: string | null;
  jct_published: string | null;
  populace_estimate: number | null;
  populace_window: string | null;
  populace_annual: Record<string, number> | null;
  // Derived (relative to jct_score, i.e. the FY2027 benchmark where available).
  abs_error: number | null; // populace − jct (USD)
  relative_error: number | null; // (populace − jct) / |jct|
  abs_relative_error: number | null;
  within_10pct: boolean | null;
  direction: "over" | "under" | "exact" | null;
}

export interface ReformValidation {
  available: true;
  source: "huggingface_live";
  release_id: string;
  updated_at: string | null;
  schema_version: unknown;
  baseline_period: number | null;
  scoring_window: string | null;
  rows: ReformValidationRow[];
  summary: {
    n_reforms: number;
    n_scored: number; // reforms with both a JCT score and a populace estimate
    within_10pct: number;
    mean_abs_relative_error: number | null;
    median_abs_relative_error: number | null;
    // The out-of-sample reforms only — the genuine fidelity test.
    n_out_of_sample: number;
    n_out_of_sample_scored: number;
    out_of_sample_within_10pct: number;
    out_of_sample_mean_abs_relative_error: number | null;
  };
}

function enrichReform(raw: JsonObject): ReformValidationRow {
  const jct = asObject(raw.jct);
  const populace = asObject(raw.populace);
  const jctFy2026 = numberOrNull(jct.score);
  const jctFy2027 = numberOrNull(jct.score_fy2027);
  // Benchmark defaults to JCT's first full fiscal year (FY2027). FY2026 is a
  // partial ramp year for provisions effective 1/1/2026, so error vs FY2026
  // overstates the gap against populace's calendar-year liability. In-sample
  // rows have no FY2027 figure, so they fall back to their annual (FY2026) one.
  const benchmark = jctFy2027 ?? jctFy2026;
  const estimate = numberOrNull(populace.budget_effect);
  const absError = benchmark != null && estimate != null ? estimate - benchmark : null;
  // A zero benchmark has no meaningful relative error — leave it unscored
  // rather than storing the raw dollar delta, which would otherwise be treated
  // as a fraction and blow up within_10pct and the mean/median aggregates.
  const relError =
    benchmark != null && estimate != null && benchmark !== 0
      ? (estimate - benchmark) / Math.abs(benchmark)
      : null;
  const absRel = relError == null ? null : Math.abs(relError);
  const annual = asObject(populace.annual);
  const annualClean: Record<string, number> = {};
  for (const [k, v] of Object.entries(annual)) {
    const n = numberOrNull(v);
    if (n != null) annualClean[k] = n;
  }
  return {
    id: String(raw.id ?? raw.name ?? ""),
    name: String(raw.name ?? raw.id ?? ""),
    category: stringOrNull(raw.category),
    description: stringOrNull(raw.description),
    in_sample: raw.in_sample === true,
    period: numberOrNull(raw.period),
    jct_score: benchmark,
    jct_score_fy2026: jctFy2026,
    jct_score_type: stringOrNull(jct.score_type),
    jct_window: stringOrNull(jct.window),
    jct_benchmark_window: jctFy2027 != null ? "FY2027" : stringOrNull(jct.window),
    jct_source: stringOrNull(jct.source),
    jct_source_url: stringOrNull(jct.source_url),
    jct_published: stringOrNull(jct.published),
    populace_estimate: estimate,
    populace_window: stringOrNull(populace.window),
    populace_annual: Object.keys(annualClean).length ? annualClean : null,
    abs_error: absError,
    relative_error: relError,
    abs_relative_error: absRel,
    within_10pct: absRel == null ? null : absRel <= 0.1,
    direction:
      absError == null ? null : absError > 0 ? "over" : absError < 0 ? "under" : "exact",
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildReformValidation(
  raw: JsonObject,
  releaseId: string,
  updatedAt: string | null = null,
): ReformValidation {
  const reforms = Array.isArray(raw.reforms) ? (raw.reforms as JsonObject[]) : [];
  const rows = reforms.map((r) => enrichReform(asObject(r)));
  const scored = rows.filter((r) => r.abs_relative_error != null);
  const absRels = scored.map((r) => r.abs_relative_error as number);
  const oos = rows.filter((r) => !r.in_sample);
  const oosScored = oos.filter((r) => r.abs_relative_error != null);
  const oosAbsRels = oosScored.map((r) => r.abs_relative_error as number);
  return {
    available: true,
    source: "huggingface_live",
    release_id: String(raw.release_id ?? releaseId),
    updated_at: updatedAt,
    schema_version: raw.schema_version ?? null,
    baseline_period: numberOrNull(raw.baseline_period),
    scoring_window: stringOrNull(raw.scoring_window),
    rows,
    summary: {
      n_reforms: rows.length,
      n_scored: scored.length,
      within_10pct: scored.filter((r) => r.within_10pct === true).length,
      mean_abs_relative_error: absRels.length
        ? absRels.reduce((s, v) => s + v, 0) / absRels.length
        : null,
      median_abs_relative_error: median(absRels),
      n_out_of_sample: oos.length,
      n_out_of_sample_scored: oosScored.length,
      out_of_sample_within_10pct: oosScored.filter((r) => r.within_10pct === true).length,
      out_of_sample_mean_abs_relative_error: oosAbsRels.length
        ? oosAbsRels.reduce((s, v) => s + v, 0) / oosAbsRels.length
        : null,
    },
  };
}

// "Not published" is an expected state (the producer artifact may not exist for
// older releases), so callers distinguish it from a transport failure.
export interface ReformValidationMissing {
  available: false;
  release_id: string;
  reason: string;
  expected_path: string;
}

async function fetchReformValidation(
  releaseId: string,
  revalidate: number,
): Promise<JsonObject | null> {
  const override = REFORM_OVERRIDES[releaseId]
    ? asObject(REFORM_OVERRIDES[releaseId])
    : null;

  const url = hfResolveUrl(
    `releases/${assertSafeReleaseId(releaseId)}/${REFORM_VALIDATION_FILE}`,
  );
  let artifact: JsonObject | null = null;
  try {
    const res = await fetch(url, {
      next: { revalidate },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) artifact = asObject(await res.json());
    else if (res.status !== 404) {
      throw new Error(`HF fetch failed ${res.status}: ${url}`);
    }
  } catch (error) {
    // If the native artifact can't be read, still serve the committed override
    // (that is exactly the release it was backfilled for). Only surface the
    // error when there is no override to fall back to.
    if (!override) throw error;
  }

  // The override is a committed backfill for releases whose native artifact
  // predates whole benchmark suites (SOI-actual, federal-EITC-by-state, the
  // state-program suites) AND ships un-simulated out-of-sample rows. Merge by
  // reform id rather than picking one side wholesale: when the native artifact
  // re-simulated a reform (out_of_sample_simulated === true) its score is
  // fresher and wins for that id, but the suites only the backfill carries must
  // still come through — otherwise the cross-dataset view loses its entire
  // comparable surface. When native is un-simulated, the backfill wins shared
  // ids too, and any native-only reforms are still carried along.
  if (artifact && override) {
    return mergeReformSuites(artifact, override, artifact.out_of_sample_simulated === true);
  }
  if (override) return override;
  return artifact;
}

// Union the native and backfilled reform lists by id. `preferNative` decides
// which side wins a shared id; rows unique to the other side are always kept,
// so no benchmark suite is dropped just because the two artifacts overlap.
function mergeReformSuites(
  artifact: JsonObject,
  override: JsonObject,
  preferNative: boolean,
): JsonObject {
  const reformsOf = (o: JsonObject): JsonObject[] =>
    Array.isArray(o.reforms) ? (o.reforms as JsonObject[]) : [];
  const idOf = (r: JsonObject): string | null => (typeof r.id === "string" ? r.id : null);

  const winner = preferNative ? reformsOf(artifact) : reformsOf(override);
  const filler = preferNative ? reformsOf(override) : reformsOf(artifact);
  const seen = new Set(winner.map(idOf).filter((id): id is string => id != null));
  const merged = [...winner, ...filler.filter((r) => idOf(r) != null && !seen.has(idOf(r)!))];

  // Metadata (release_id, scoring window, the out_of_sample_simulated flag)
  // comes from the winning side so downstream logic reads a consistent header.
  const base = preferNative ? artifact : override;
  return { ...base, reforms: merged };
}

export async function loadReformValidation(
  releaseId: string,
  revalidate: number,
): Promise<ReformValidation | ReformValidationMissing> {
  let id = releaseId;
  let updatedAt: string | null = null;
  if (releaseId === "latest" || !releaseId) {
    const ptr = await loadPointerReleaseId(revalidate);
    id = ptr.release_id;
    updatedAt = ptr.updated_at;
  }
  const raw = await fetchReformValidation(id, revalidate);
  if (!raw) {
    return {
      available: false,
      release_id: id,
      reason: `No ${REFORM_VALIDATION_FILE} published for this release yet.`,
      expected_path: `releases/${id}/${REFORM_VALIDATION_FILE}`,
    };
  }
  return buildReformValidation(raw, id, updatedAt);
}

// --- run-over-run --------------------------------------------------------------
// Per reform, the populace-vs-JCT error across every release that published a
// reform_validation.json — so we can see whether the dataset's reproduction of
// scored reforms is improving from build to build.
export interface ReformHistoryPoint {
  release_id: string;
  date: string;
  populace_estimate: number | null;
  relative_error: number | null;
  abs_relative_error: number | null;
}

export interface ReformHistorySeries {
  id: string;
  name: string;
  category: string | null;
  in_sample: boolean;
  jct_score: number | null;
  jct_source: string | null;
  points: ReformHistoryPoint[]; // chronological, oldest → newest
  latest_abs_relative_error: number | null;
  delta: number | null; // newest |rel err| − previous |rel err| (− = improving)
  last_seen_release: string | null;
  retired: boolean; // absent from the newest release (renamed/removed row id)
}

export interface ReformHistory {
  releases: { release_id: string; date: string }[];
  reforms: ReformHistorySeries[];
}

export function buildReformHistory(
  builds: { release_id: string; date: string; validation: ReformValidation }[],
): ReformHistory {
  // Oldest → newest so a series reads left-to-right in time.
  const chronological = [...builds].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const series = new Map<string, ReformHistorySeries>();
  for (const build of chronological) {
    for (const row of build.validation.rows) {
      let s = series.get(row.id);
      if (!s) {
        s = {
          id: row.id,
          name: row.name,
          category: row.category,
          in_sample: row.in_sample,
          jct_score: row.jct_score,
          jct_source: row.jct_source,
          points: [],
          latest_abs_relative_error: null,
          delta: null,
          last_seen_release: null,
          retired: false,
        };
        series.set(row.id, s);
      }
      s.name = row.name;
      s.jct_score = row.jct_score ?? s.jct_score;
      // Keep classification current with the latest release the row appears in,
      // not frozen at first sighting.
      s.category = row.category;
      s.in_sample = row.in_sample;
      s.last_seen_release = build.release_id;
      s.points.push({
        release_id: build.release_id,
        date: build.date,
        populace_estimate: row.populace_estimate,
        relative_error: row.relative_error,
        abs_relative_error: row.abs_relative_error,
      });
    }
  }
  const newestReleaseId = chronological[chronological.length - 1]?.release_id ?? null;
  const reforms = [...series.values()].map((s) => {
    const retired = s.last_seen_release !== newestReleaseId;
    const scored = s.points.filter((p) => p.abs_relative_error != null);
    const latest = scored[scored.length - 1]?.abs_relative_error ?? null;
    const prev = scored[scored.length - 2]?.abs_relative_error ?? null;
    return {
      ...s,
      retired,
      // A retired row's last error is stale, not current — don't report it as
      // the latest fit (it would otherwise rank among live reforms as if now).
      latest_abs_relative_error: retired ? null : latest,
      delta: !retired && latest != null && prev != null ? latest - prev : null,
    };
  });
  // Live reforms ranked worst-first; retired rows sink below all of them.
  reforms.sort(
    (a, b) =>
      Number(a.retired) - Number(b.retired) ||
      (b.latest_abs_relative_error ?? -1) - (a.latest_abs_relative_error ?? -1),
  );
  return {
    releases: chronological.map((b) => ({ release_id: b.release_id, date: b.date })),
    reforms,
  };
}

export async function loadReformHistory(revalidate: number): Promise<ReformHistory> {
  const releases = await loadReleases(revalidate);
  const builds = await Promise.all(
    releases.map(async (r) => {
      try {
        const raw = await fetchReformValidation(r.release_id, revalidate);
        if (!raw) return null;
        return {
          release_id: r.release_id,
          date: r.date,
          validation: buildReformValidation(raw, r.release_id),
        };
      } catch (error) {
        // Best-effort: a release that fails to load is dropped from the
        // history rather than failing the whole view — but log it so a
        // transient HF failure isn't mistaken for "release has no reforms."
        console.error(`Reform history: skipped ${r.release_id}:`, error);
        return null;
      }
    }),
  );
  return buildReformHistory(builds.filter((b): b is NonNullable<typeof b> => b != null));
}

export const REFORM_VALIDATION_REPO = POPULACE_HF_REPO;
