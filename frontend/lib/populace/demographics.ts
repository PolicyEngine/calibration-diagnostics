// Demographic diagnostics data layer. Reads demographics.json (published per
// release by the populace build) live from Hugging Face: the dataset's weighted
// population by age band, its share, the Census benchmark, and the fit error.
// The fiscal release does not calibrate the age distribution, so this is an
// emergent diagnostic — useful for seeing population-by-age and how it tracks
// Census release over release.

import { asObject, hfResolveUrl, loadPointerReleaseId, loadReleases } from "./latest-artifact";

type JsonObject = Record<string, unknown>;

export const DEMOGRAPHICS_FILE = "demographics.json";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export interface AgeBandRow {
  label: string;
  min_age: number | null;
  max_age: number | null;
  population: number | null;
  share: number | null;
  benchmark: number | null;
  benchmark_share: number | null;
  relative_error: number | null;
  abs_relative_error: number | null;
}

export interface Demographics {
  available: true;
  source: "huggingface_live";
  release_id: string;
  updated_at: string | null;
  schema_version: unknown;
  period: number | null;
  measure: string | null;
  total_population: number | null;
  benchmark_total_population: number | null;
  benchmark_source: string | null;
  bands: AgeBandRow[];
  summary: {
    n_bands: number;
    n_benchmarked: number;
    mean_abs_relative_error: number | null;
    max_abs_relative_error: number | null;
    total_vs_benchmark: number | null; // (total − benchmark_total) / benchmark_total
  };
}

export interface DemographicsMissing {
  available: false;
  release_id: string;
  reason: string;
  expected_path: string;
}

function enrichBand(raw: JsonObject): AgeBandRow {
  const rel = numberOrNull(raw.relative_error);
  return {
    label: String(raw.label ?? ""),
    min_age: numberOrNull(raw.min_age),
    max_age: numberOrNull(raw.max_age),
    population: numberOrNull(raw.population),
    share: numberOrNull(raw.share),
    benchmark: numberOrNull(raw.benchmark),
    benchmark_share: numberOrNull(raw.benchmark_share),
    relative_error: rel,
    abs_relative_error: rel == null ? null : Math.abs(rel),
  };
}

export function buildDemographics(
  raw: JsonObject,
  releaseId: string,
  updatedAt: string | null = null,
): Demographics {
  const bands = (Array.isArray(raw.age_bands) ? (raw.age_bands as JsonObject[]) : []).map((b) =>
    enrichBand(asObject(b)),
  );
  const benchmarked = bands.filter((b) => b.abs_relative_error != null);
  const absErrs = benchmarked.map((b) => b.abs_relative_error as number);
  const total = numberOrNull(raw.total_population);
  const benchTotal = numberOrNull(raw.benchmark_total_population);
  return {
    available: true,
    source: "huggingface_live",
    release_id: String(raw.release_id ?? releaseId),
    updated_at: updatedAt,
    schema_version: raw.schema_version ?? null,
    period: numberOrNull(raw.period),
    measure: stringOrNull(raw.measure),
    total_population: total,
    benchmark_total_population: benchTotal,
    benchmark_source: stringOrNull(raw.benchmark_source),
    bands,
    summary: {
      n_bands: bands.length,
      n_benchmarked: benchmarked.length,
      mean_abs_relative_error: absErrs.length
        ? absErrs.reduce((s, v) => s + v, 0) / absErrs.length
        : null,
      max_abs_relative_error: absErrs.length ? Math.max(...absErrs) : null,
      total_vs_benchmark:
        total != null && benchTotal != null && benchTotal !== 0
          ? (total - benchTotal) / benchTotal
          : null,
    },
  };
}

async function fetchDemographics(releaseId: string, revalidate: number): Promise<JsonObject | null> {
  const url = hfResolveUrl(`releases/${releaseId}/${DEMOGRAPHICS_FILE}`);
  const res = await fetch(url, { next: { revalidate } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HF fetch failed ${res.status}: ${url}`);
  return asObject(await res.json());
}

export async function loadDemographics(
  releaseId: string,
  revalidate: number,
): Promise<Demographics | DemographicsMissing> {
  let id = releaseId;
  let updatedAt: string | null = null;
  if (releaseId === "latest" || !releaseId) {
    const ptr = await loadPointerReleaseId(revalidate);
    id = ptr.release_id;
    updatedAt = ptr.updated_at;
  }
  const raw = await fetchDemographics(id, revalidate);
  if (!raw) {
    return {
      available: false,
      release_id: id,
      reason: `No ${DEMOGRAPHICS_FILE} published for this release yet.`,
      expected_path: `releases/${id}/${DEMOGRAPHICS_FILE}`,
    };
  }
  return buildDemographics(raw, id, updatedAt);
}

// --- run-over-run --------------------------------------------------------------
export interface DemographicsHistoryPoint {
  release_id: string;
  date: string;
  total_population: number | null;
  total_vs_benchmark: number | null;
  mean_abs_relative_error: number | null;
}

export interface DemographicsHistory {
  benchmark_total_population: number | null;
  points: DemographicsHistoryPoint[]; // chronological, oldest → newest
}

export function buildDemographicsHistory(
  builds: { release_id: string; date: string; demographics: Demographics }[],
): DemographicsHistory {
  const chronological = [...builds].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    benchmark_total_population:
      chronological[chronological.length - 1]?.demographics.benchmark_total_population ?? null,
    points: chronological.map((b) => ({
      release_id: b.release_id,
      date: b.date,
      total_population: b.demographics.total_population,
      total_vs_benchmark: b.demographics.summary.total_vs_benchmark,
      mean_abs_relative_error: b.demographics.summary.mean_abs_relative_error,
    })),
  };
}

export async function loadDemographicsHistory(revalidate: number): Promise<DemographicsHistory> {
  const releases = await loadReleases(revalidate);
  const builds = await Promise.all(
    releases.map(async (r) => {
      try {
        const raw = await fetchDemographics(r.release_id, revalidate);
        if (!raw) return null;
        return {
          release_id: r.release_id,
          date: r.date,
          demographics: buildDemographics(raw, r.release_id),
        };
      } catch {
        return null;
      }
    }),
  );
  return buildDemographicsHistory(builds.filter((b): b is NonNullable<typeof b> => b != null));
}
