import buildManifestData from "@/data/populace/latest/build_manifest.json";
import releaseManifestData from "@/data/populace/latest/release_manifest.json";
import latestPointerData from "@/data/populace/latest/latest.json";
import calibrationDiagnosticsData from "@/data/populace/latest/calibration_diagnostics.json";

type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;

const BUILD_MANIFEST = buildManifestData as JsonObject;
const RELEASE_MANIFEST = releaseManifestData as JsonObject;
const LATEST_POINTER = latestPointerData as JsonObject;
const CALIBRATION_DIAGNOSTICS = calibrationDiagnosticsData as JsonObject;
const TARGET_ROWS = Array.isArray(CALIBRATION_DIAGNOSTICS.targets)
  ? (CALIBRATION_DIAGNOSTICS.targets as TargetRow[]).map(enrichTargetRow)
  : [];

export const LATEST_POPULACE_RELEASE_ID = String(
  BUILD_MANIFEST.build_id ?? LATEST_POINTER.release_id ?? "populace-us",
);
export const POPULACE_HF_REPO = "policyengine/populace-us";
export const LATEST_POPULACE_BUILD_MANIFEST_PATH =
  "frontend/data/populace/latest/build_manifest.json";
export const LATEST_POPULACE_RELEASE_MANIFEST_PATH =
  "frontend/data/populace/latest/release_manifest.json";
export const LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH =
  "frontend/data/populace/latest/calibration_diagnostics.json";

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

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relativeError(estimate: number | null, target: number | null): number | null {
  if (estimate == null || target == null) return null;
  // The artifact's own convention: relative miss against the target, falling
  // back to the absolute miss when the target is zero (relative is undefined).
  return target === 0 ? estimate - target : (estimate - target) / Math.abs(target);
}

// Targets are named hierarchically (e.g. "nation/irs/...", "state/census/...",
// "state/AL/adjusted_gross_income/..."). Derive a coarse source family for
// filtering: national/state sources keep their source segment; the per-state
// distribution targets (2-letter state code in slot 2) collapse to one family.
function deriveFamily(name: string): string {
  const parts = name.split("/");
  if (parts.length < 2) return name;
  const [geo, second] = parts;
  // Per-state distribution targets ("state/AL/...") collapse to one family.
  if (/^[A-Z]{2}$/.test(second)) return "state_distribution";
  // Per-state-FIPS program targets ("US01/snap-cost") collapse to the measure
  // ("snap-cost") so all 51 states form one family, not 51.
  if (/^US\d{2}$/.test(geo)) return second;
  return `${geo}/${second}`;
}

function deriveState(name: string): string | null {
  const parts = name.split("/");
  return parts.length >= 2 && /^[A-Z]{2}$/.test(parts[1]) ? parts[1] : null;
}

function enrichTargetRow(row: TargetRow): TargetRow {
  const name = String(row.name ?? "");
  const target = numberOrNull(row.target);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  const finalRel = numberOrNull(row.relative_error) ?? relativeError(final, target);
  const initialRel = relativeError(initial, target);
  const absFinalRel = finalRel == null ? null : Math.abs(finalRel);
  // Did calibration help? Positive when the calibrated estimate is closer to
  // the target (in relative terms) than the design-weight estimate was.
  const improvement =
    initialRel == null || finalRel == null
      ? null
      : Math.abs(initialRel) - Math.abs(finalRel);
  return {
    ...row,
    family: deriveFamily(name),
    state: deriveState(name),
    initial_relative_error: initialRel,
    abs_relative_error: absFinalRel,
    improvement,
    direction:
      finalRel == null ? null : finalRel > 0 ? "over" : finalRel < 0 ? "under" : "exact",
  };
}

function stringParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function booleanParam(value: string | null): boolean | null {
  if (value == null || value === "") return null;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  return null;
}

function matchesSearch(row: TargetRow, search: string): boolean {
  const haystack = [row.name, row.family, row.state]
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

export function populaceTargetFamilies(): string[] {
  return [...new Set(TARGET_ROWS.map((row) => String(row.family ?? "")))].sort();
}

function withinToleranceCount(rows: TargetRow[]): number {
  return rows.filter((row) => row.within_tolerance === true).length;
}

export function latestPopulaceBuildManifest(): JsonObject {
  return BUILD_MANIFEST;
}

export function latestPopulaceReleaseManifest(): JsonObject {
  return RELEASE_MANIFEST;
}

export function latestPopulacePointer(): JsonObject {
  return LATEST_POINTER;
}

// Per-family calibration fit: how well each source family is reproduced,
// computed from the per-target rows (replaces the eCPS family breakdown the
// retired comparison artifact used to carry).
function familyFitSummary() {
  const groups = new Map<string, TargetRow[]>();
  for (const row of TARGET_ROWS) {
    const family = String(row.family ?? "");
    const bucket = groups.get(family) ?? [];
    bucket.push(row);
    groups.set(family, bucket);
  }
  return [...groups.entries()]
    .map(([family, rows]) => {
      const absErrors = rows
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((value): value is number => value != null);
      const meanAbsError = absErrors.length
        ? absErrors.reduce((sum, value) => sum + value, 0) / absErrors.length
        : null;
      return {
        family,
        n_targets: rows.length,
        within_tolerance: withinToleranceCount(rows),
        within_10pct: rows.filter(
          (row) => (numberOrNull(row.abs_relative_error) ?? Infinity) <= 0.1,
        ).length,
        mean_abs_relative_error: meanAbsError,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);
}

export function latestPopulaceCalibrationSummary() {
  return {
    available: true,
    path: LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH,
    release_id: CALIBRATION_DIAGNOSTICS.release_id ?? LATEST_POPULACE_RELEASE_ID,
    schema_version: CALIBRATION_DIAGNOSTICS.schema_version ?? null,
    weight_entity: CALIBRATION_DIAGNOSTICS.weight_entity ?? null,
    options: asObject(CALIBRATION_DIAGNOSTICS.options),
    l0_lambda: numberOrNull(CALIBRATION_DIAGNOSTICS.l0_lambda),
    n_nonzero: numberOrNull(CALIBRATION_DIAGNOSTICS.n_nonzero),
    n_records: numberOrNull(CALIBRATION_DIAGNOSTICS.n_records),
    initial_loss: numberOrNull(CALIBRATION_DIAGNOSTICS.initial_loss),
    final_loss: numberOrNull(CALIBRATION_DIAGNOSTICS.final_loss),
    fraction_within_10pct: numberOrNull(CALIBRATION_DIAGNOSTICS.fraction_within_10pct),
    loss_trajectory: Array.isArray(CALIBRATION_DIAGNOSTICS.loss_trajectory)
      ? (CALIBRATION_DIAGNOSTICS.loss_trajectory as number[])
      : [],
    skipped: Array.isArray(CALIBRATION_DIAGNOSTICS.skipped)
      ? (CALIBRATION_DIAGNOSTICS.skipped as JsonObject[])
      : [],
    total_targets: TARGET_ROWS.length,
    within_tolerance_count: withinToleranceCount(TARGET_ROWS),
    family_fit: familyFitSummary(),
  };
}

function worstFit(limit: number): TargetRow[] {
  return [...TARGET_ROWS]
    .filter((row) => numberOrNull(row.abs_relative_error) != null)
    .sort(
      (a, b) =>
        (numberOrNull(b.abs_relative_error) ?? 0) -
        (numberOrNull(a.abs_relative_error) ?? 0),
    )
    .slice(0, limit);
}

function biggestImprovements(limit: number): TargetRow[] {
  return [...TARGET_ROWS]
    .filter((row) => numberOrNull(row.improvement) != null)
    .sort(
      (a, b) => (numberOrNull(b.improvement) ?? 0) - (numberOrNull(a.improvement) ?? 0),
    )
    .slice(0, limit);
}

export function latestPopulaceCalibrationHighlights(limit = 15) {
  return {
    worst_fit: worstFit(limit),
    biggest_improvements: biggestImprovements(limit),
  };
}

export function latestPopulaceTargetDiagnosticsSummary(displayLimit = 100) {
  return {
    ...latestPopulaceCalibrationSummary(),
    families: populaceTargetFamilies(),
    display_limit: displayLimit,
    targets: TARGET_ROWS.slice(0, displayLimit),
  };
}

export function latestPopulaceTargetDiagnosticsPage(requestUrl: string) {
  const url = new URL(requestUrl);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1),
    500,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
  const family = stringParam(url.searchParams.get("family"));
  const state = stringParam(url.searchParams.get("state"));
  const direction = stringParam(url.searchParams.get("direction"));
  const within = booleanParam(url.searchParams.get("within_tolerance"));
  const search = stringParam(url.searchParams.get("search"));
  const sortBy = stringParam(url.searchParams.get("sort_by")) ?? "abs_relative_error";
  const sortDir =
    stringParam(url.searchParams.get("sort_dir")) === "asc" ? "asc" : "desc";

  let filtered = TARGET_ROWS;
  if (family) filtered = filtered.filter((row) => row.family === family);
  if (state) filtered = filtered.filter((row) => row.state === state);
  if (direction) filtered = filtered.filter((row) => row.direction === direction);
  if (within !== null)
    filtered = filtered.filter((row) => row.within_tolerance === within);
  if (search) filtered = filtered.filter((row) => matchesSearch(row, search));
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

  return {
    available: true,
    path: LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH,
    release_id: CALIBRATION_DIAGNOSTICS.release_id ?? LATEST_POPULACE_RELEASE_ID,
    schema_version: CALIBRATION_DIAGNOSTICS.schema_version ?? null,
    metric: "relative_error",
    families: populaceTargetFamilies(),
    summary: {
      total_targets: TARGET_ROWS.length,
      within_tolerance_count: withinToleranceCount(TARGET_ROWS),
      fraction_within_10pct: numberOrNull(
        CALIBRATION_DIAGNOSTICS.fraction_within_10pct,
      ),
    },
    total_targets: TARGET_ROWS.length,
    filtered_total: filtered.length,
    returned: filtered.slice(offset, offset + limit).length,
    limit,
    offset,
    has_next: offset + limit < filtered.length,
    display_limit: limit,
    targets: filtered.slice(offset, offset + limit),
    filters: {
      family,
      state,
      direction,
      within_tolerance: within,
      search,
      sort_by: sortBy,
      sort_dir: sortDir,
    },
  };
}
