import targetDiagnosticsData from "@/data/microplex/latest/pe_native_target_diagnostics.json";
import nativeScoresData from "@/data/microplex/latest/policyengine_native_scores.json";

type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;

const TARGET_DIAGNOSTICS = targetDiagnosticsData as JsonObject;
const NATIVE_SCORES = nativeScoresData as JsonObject;
const TARGET_ROWS = Array.isArray(TARGET_DIAGNOSTICS.targets)
  ? (TARGET_DIAGNOSTICS.targets as TargetRow[]).map(enrichTargetRow)
  : [];
const NATIVE_SUMMARY = asObject(NATIVE_SCORES.summary);

export const LATEST_MICROPLEX_ARTIFACT_ID = String(
  TARGET_DIAGNOSTICS.artifact_id ?? "production-target-diagnostics-100k-national-rescaled-v1",
);
export const LATEST_MICROPLEX_TARGET_DIAGNOSTICS_PATH =
  "frontend/data/microplex/latest/pe_native_target_diagnostics.json";
export const LATEST_MICROPLEX_NATIVE_SCORES_PATH =
  "frontend/data/microplex/latest/policyengine_native_scores.json";

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

function estimate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relativeDifference(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return numerator / Math.abs(denominator);
}

function enrichTargetRow(row: TargetRow): TargetRow {
  const target = estimate(row.target_value);
  const usData = estimate(row.us_data_aggregate ?? row.from_estimate);
  const microplex = estimate(row.microplex_aggregate ?? row.to_estimate);
  const deltaAbsError = estimate(row.delta_absolute_error);
  const microplexVsTarget =
    microplex != null && target != null ? microplex - target : null;
  const usDataVsTarget =
    usData != null && target != null ? usData - target : null;
  const microplexVsUsData =
    microplex != null && usData != null ? microplex - usData : null;

  return {
    ...row,
    microplex_vs_target: microplexVsTarget,
    us_data_vs_target: usDataVsTarget,
    microplex_vs_us_data: microplexVsUsData,
    microplex_vs_target_relative:
      relativeDifference(microplexVsTarget, target),
    us_data_vs_target_relative:
      relativeDifference(usDataVsTarget, target),
    microplex_vs_us_data_relative:
      relativeDifference(microplexVsUsData, usData),
    closer_dataset:
      deltaAbsError == null
        ? null
        : deltaAbsError < 0
          ? "microplex"
          : deltaAbsError > 0
            ? "us-data"
            : "tie",
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
  const haystack = [
    row.target_id,
    row.target_name,
    row.family,
    row.target_family,
    row.variable,
    row.entity,
    row.geography,
    row.state,
  ]
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

export function latestNativeScores() {
  return {
    available: true,
    source: "deployed_static_artifact",
    source_path: LATEST_MICROPLEX_NATIVE_SCORES_PATH,
    artifact_id: LATEST_MICROPLEX_ARTIFACT_ID,
    metric: NATIVE_SCORES.metric ?? NATIVE_SUMMARY.metric ?? null,
    period: NATIVE_SCORES.period ?? NATIVE_SUMMARY.period ?? null,
    baseline_enhanced_cps_native_loss: numberOrNull(
      NATIVE_SUMMARY.baseline_enhanced_cps_native_loss,
    ),
    candidate_enhanced_cps_native_loss: numberOrNull(
      NATIVE_SUMMARY.candidate_enhanced_cps_native_loss,
    ),
    enhanced_cps_native_loss_delta: numberOrNull(
      NATIVE_SUMMARY.enhanced_cps_native_loss_delta,
    ),
    baseline_unweighted_msre: numberOrNull(
      NATIVE_SUMMARY.baseline_unweighted_msre,
    ),
    candidate_unweighted_msre: numberOrNull(
      NATIVE_SUMMARY.candidate_unweighted_msre,
    ),
    unweighted_msre_delta: numberOrNull(NATIVE_SUMMARY.unweighted_msre_delta),
    candidate_beats_baseline:
      typeof NATIVE_SUMMARY.candidate_beats_baseline === "boolean"
        ? NATIVE_SUMMARY.candidate_beats_baseline
        : null,
    n_targets_total: numberOrNull(NATIVE_SUMMARY.n_targets_total),
    n_targets_kept: numberOrNull(NATIVE_SUMMARY.n_targets_kept),
    n_national_targets: numberOrNull(NATIVE_SUMMARY.n_national_targets),
    n_state_targets: numberOrNull(NATIVE_SUMMARY.n_state_targets),
    n_targets_bad_dropped: numberOrNull(NATIVE_SUMMARY.n_targets_bad_dropped),
    n_targets_zero_dropped: numberOrNull(NATIVE_SUMMARY.n_targets_zero_dropped),
    target_rows_available: true,
    full_target_diagnostics_path: LATEST_MICROPLEX_TARGET_DIAGNOSTICS_PATH,
    full_target_diagnostics_manifest_key:
      "policyengine_native_target_diagnostics",
  };
}

export function latestTargetDiagnosticsSummary(displayLimit = 100) {
  return {
    available: true,
    path: LATEST_MICROPLEX_TARGET_DIAGNOSTICS_PATH,
    diagnostic_schema_version:
      TARGET_DIAGNOSTICS.diagnostic_schema_version ?? null,
    metric: TARGET_DIAGNOSTICS.metric ?? null,
    period: TARGET_DIAGNOSTICS.period ?? null,
    baseline_dataset: TARGET_DIAGNOSTICS.baseline_dataset ?? null,
    candidate_dataset: TARGET_DIAGNOSTICS.candidate_dataset ?? null,
    dataset_labels: TARGET_DIAGNOSTICS.dataset_labels ?? {},
    summary: TARGET_DIAGNOSTICS.summary ?? {},
    total_targets: TARGET_ROWS.length,
    display_limit: displayLimit,
    targets: TARGET_ROWS.slice(0, displayLimit),
  };
}

export function latestTargetDiagnosticsPage(requestUrl: string) {
  const url = new URL(requestUrl);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1),
    500,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
  const family = stringParam(url.searchParams.get("family"));
  const state = stringParam(url.searchParams.get("state"));
  const geoLevel = stringParam(url.searchParams.get("geo_level"));
  const sortBy = stringParam(url.searchParams.get("sort_by"));
  const sortDir =
    stringParam(url.searchParams.get("sort_dir")) === "desc" ? "desc" : "asc";
  const microplexTargetDirection = stringParam(
    url.searchParams.get("microplex_target_direction"),
  );
  const search = stringParam(url.searchParams.get("search"));
  const supported = booleanParam(url.searchParams.get("supported"));
  const inLoss = booleanParam(url.searchParams.get("in_loss"));

  let filtered = TARGET_ROWS;
  if (family) {
    filtered = filtered.filter(
      (row) => row.family === family || row.target_family === family,
    );
  }
  if (state) {
    filtered = filtered.filter((row) => row.state === state);
  }
  if (geoLevel) {
    filtered = filtered.filter((row) => row.geo_level === geoLevel);
  }
  if (microplexTargetDirection) {
    filtered = filtered.filter((row) => {
      const relative = estimate(row.microplex_vs_target_relative);
      if (relative == null) return false;
      if (microplexTargetDirection === "above") return relative > 0;
      if (microplexTargetDirection === "below") return relative < 0;
      if (microplexTargetDirection === "near") return Math.abs(relative) <= 0.05;
      return true;
    });
  }
  if (supported !== null) {
    filtered = filtered.filter((row) => row.supported_by_microplex === supported);
  }
  if (inLoss !== null) {
    filtered = filtered.filter((row) => row.in_loss === inLoss);
  }
  if (search) {
    filtered = filtered.filter((row) => matchesSearch(row, search));
  }
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
    ...latestTargetDiagnosticsSummary(limit),
    returned: filtered.slice(offset, offset + limit).length,
    limit,
    offset,
    has_next: offset + limit < filtered.length,
    total_targets: TARGET_ROWS.length,
    filtered_total: filtered.length,
    targets: filtered.slice(offset, offset + limit),
    unfiltered_total_targets: TARGET_ROWS.length,
    filters: {
      family,
      state,
      geo_level: geoLevel,
      microplex_target_direction: microplexTargetDirection,
      supported,
      in_loss: inLoss,
      search,
      sort_by: sortBy,
      sort_dir: sortBy ? sortDir : null,
    },
    microplex_bundle: {
      artifact_id: LATEST_MICROPLEX_ARTIFACT_ID,
      artifact_dir:
        "artifacts/issue_133_production_target_diagnostics_20260602/production-target-diagnostics-100k-national-rescaled-v1",
      target_diagnostics_path: LATEST_MICROPLEX_TARGET_DIAGNOSTICS_PATH,
      native_scores_path: LATEST_MICROPLEX_NATIVE_SCORES_PATH,
    },
  };
}

export function latestHeadlinePatch() {
  const wins = numberOrNull(asObject(TARGET_DIAGNOSTICS.summary).to_wins);
  const nTargets = TARGET_ROWS.length || null;
  return {
    baseline_label: "policyengine_us_data",
    candidate_label: "microplex",
    calibration_target_profile: "pe_native_broad",
    target_period: TARGET_DIAGNOSTICS.period ?? NATIVE_SCORES.period ?? null,
    target_win_rate:
      wins != null && nTargets ? wins / nTargets : null,
  };
}
