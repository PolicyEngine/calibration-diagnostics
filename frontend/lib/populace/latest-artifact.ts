import buildManifestData from "@/data/populace/latest/build_manifest.json";
import releaseManifestData from "@/data/populace/latest/release_manifest.json";
import comparisonSummaryData from "@/data/populace/latest/comparison_summary.json";
import targetDiagnosticsData from "@/data/populace/latest/target_diagnostics.json";

type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;

const BUILD_MANIFEST = buildManifestData as JsonObject;
const RELEASE_MANIFEST = releaseManifestData as JsonObject;
const COMPARISON_SUMMARY = comparisonSummaryData as JsonObject;
const TARGET_DIAGNOSTICS = targetDiagnosticsData as JsonObject;
const TARGET_ROWS = Array.isArray(TARGET_DIAGNOSTICS.targets)
  ? (TARGET_DIAGNOSTICS.targets as TargetRow[])
  : [];

export const LATEST_POPULACE_RELEASE_ID = String(
  BUILD_MANIFEST.build_id ?? "populace-us-2024-9f1260b-20260611",
);
export const POPULACE_HF_REPO = "policyengine/populace-us";
export const LATEST_POPULACE_BUILD_MANIFEST_PATH =
  "frontend/data/populace/latest/build_manifest.json";
export const LATEST_POPULACE_RELEASE_MANIFEST_PATH =
  "frontend/data/populace/latest/release_manifest.json";
export const LATEST_POPULACE_COMPARISON_SUMMARY_PATH =
  "frontend/data/populace/latest/comparison_summary.json";
export const LATEST_POPULACE_TARGET_DIAGNOSTICS_PATH =
  "frontend/data/populace/latest/target_diagnostics.json";

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [key, scrub(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function stringParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function matchesSearch(row: TargetRow, search: string): boolean {
  const haystack = [row.target_name, row.family, row.split, row.winner]
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

export function latestPopulaceBuildManifest(): JsonObject {
  return BUILD_MANIFEST;
}

export function latestPopulaceReleaseManifest(): JsonObject {
  return RELEASE_MANIFEST;
}

export function latestPopulaceComparisonSummary(): JsonObject {
  return {
    available: true,
    path: LATEST_POPULACE_COMPARISON_SUMMARY_PATH,
    ...COMPARISON_SUMMARY,
  };
}

export function latestPopulaceTargetDiagnosticsSummary(displayLimit = 100) {
  return {
    available: true,
    path: LATEST_POPULACE_TARGET_DIAGNOSTICS_PATH,
    release_id: TARGET_DIAGNOSTICS.release_id ?? LATEST_POPULACE_RELEASE_ID,
    schema_version: TARGET_DIAGNOSTICS.schema_version ?? null,
    metric: TARGET_DIAGNOSTICS.metric ?? null,
    period: TARGET_DIAGNOSTICS.period ?? null,
    baseline_label: "enhanced_cps",
    candidate_label: "populace",
    summary: TARGET_DIAGNOSTICS.summary ?? {},
    total_targets: TARGET_ROWS.length,
    display_limit: displayLimit,
    targets: TARGET_ROWS.slice(0, displayLimit),
  };
}

export function populaceTargetFamilies(): string[] {
  return [...new Set(TARGET_ROWS.map((row) => String(row.family ?? "")))].sort();
}

export function latestPopulaceTargetDiagnosticsPage(requestUrl: string) {
  const url = new URL(requestUrl);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1),
    500,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
  const family = stringParam(url.searchParams.get("family"));
  const split = stringParam(url.searchParams.get("split"));
  const winner = stringParam(url.searchParams.get("winner"));
  const search = stringParam(url.searchParams.get("search"));
  const sortBy = stringParam(url.searchParams.get("sort_by"));
  const sortDir =
    stringParam(url.searchParams.get("sort_dir")) === "desc" ? "desc" : "asc";

  let filtered = TARGET_ROWS;
  if (family) filtered = filtered.filter((row) => row.family === family);
  if (split) filtered = filtered.filter((row) => row.split === split);
  if (winner) filtered = filtered.filter((row) => row.winner === winner);
  if (search) filtered = filtered.filter((row) => matchesSearch(row, search));
  if (sortBy) {
    filtered = [...filtered].sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp =
        typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  return {
    ...latestPopulaceTargetDiagnosticsSummary(limit),
    families: populaceTargetFamilies(),
    returned: filtered.slice(offset, offset + limit).length,
    limit,
    offset,
    has_next: offset + limit < filtered.length,
    filtered_total: filtered.length,
    targets: filtered.slice(offset, offset + limit),
    filters: {
      family,
      split,
      winner,
      search,
      sort_by: sortBy,
      sort_dir: sortBy ? sortDir : null,
    },
  };
}
