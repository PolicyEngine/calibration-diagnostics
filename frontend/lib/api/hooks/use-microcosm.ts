import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { releaseLabel } from "@/components/shared/format";
import {
  useCountry,
  type Country,
} from "@/components/layout/country-context";
import { withBasePath } from "@/lib/base-path";
import type { ExplorerState } from "@/lib/microcosm/calibration-explorer";
import type { CalibrationTreeResponse } from "@/lib/microcosm/calibration-tree";
import { apiGet } from "../client";

export interface MicrocosmGates {
  parity_gaps?: number | null;
  exported_nonzero?: {
    passed?: boolean | null;
    stored_columns?: number | null;
  };
  calibration?: {
    within_10pct_share?: number | null;
    loss?: number | null;
    max_weight?: number | null;
    weights_above_500k?: number | null;
    max_weight_ratio?: number | null;
  };
  smoke?: Record<string, number | null>;
  [key: string]: unknown;
}

export interface MicrocosmSkippedTarget {
  name: string;
  reason: string;
}

export interface MicrocosmTargetRow {
  name?: string | null;
  target?: number | null;
  initial_estimate?: number | null;
  final_estimate?: number | null;
  relative_error?: number | null;
  within_tolerance?: boolean | null;
  // Derived at read time.
  family?: string | null;
  state?: string | null;
  base_name?: string | null;
  geography?: string | null;
  level?: string | null;
  source?: string | null;
  variable?: string | null;
  measure?: string | null;
  target_role?: string | null;
  source_measure_id?: string | null;
  policyengine_variables?: string[] | null;
  policyengine_map_to?: string | null;
  policyengine_filter_variable?: string | null;
  materializer?: string | null;
  measure_mode?: string | null;
  error_kind?: "relative" | "absolute" | null;
  initial_error?: number | null;
  final_error?: number | null;
  initial_miss?: number | null;
  final_miss?: number | null;
  abs_final_miss?: number | null;
  absolute_improvement?: number | null;
  abs_error?: number | null;
  breakdown?: string | null;
  dims?: string[] | null;
  target_dimensions?: {
    key: string;
    label: string;
    value: string;
    source_key?: string;
    raw_value?: string;
  }[] | null;
  variable_key?: string | null;
  // schema v2 published registry metadata (null on v1).
  source_citation?: string | null;
  entity?: string | null;
  aggregation?: string | null;
  measure_name?: string | null;
  period?: number | null;
  chronicle?: {
    fact_key?: string | null;
    source_record_id?: string | null;
    semantic_fact_key?: string | null;
    aggregate_fact_key?: string | null;
    legacy_fact_key?: string | null;
    period_type?: string | null;
    source_period?: string | null;
    target_period?: string | null;
    geography_level?: string | null;
    geography_id?: string | null;
    geography_vintage?: string | null;
    domain?: string | null;
    entity_name?: string | null;
    entity_role?: string | null;
    measure_concept?: string | null;
    source_concept?: string | null;
    concept_relation?: string | null;
    concept_authority?: string | null;
    measure_unit?: string | null;
    value_operation?: string | null;
    layout_record_set_id?: string | null;
    layout_groupby_dimension?: string | null;
    layout_groupby_value_id?: string | null;
    layout_measure_id?: string | null;
    dimension_set_key?: string | null;
    universe_constraint_set_key?: string | null;
    universe_constraint_count?: number | null;
    filters?: {
      key: string;
      label: string;
      value: string;
      raw_value?: string;
    }[];
  } | null;
  estimate_warning?: string | null;
  calibration_status?: "included" | "skipped" | "not_materialized" | null;
  calibration_status_label?: string | null;
  calibration_status_reason?: string | null;
  initial_relative_error?: number | null;
  abs_relative_error?: number | null;
  improvement?: number | null;
  direction?: "over" | "under" | "exact" | null;
  [key: string]: unknown;
}

export interface MicrocosmVariableRow {
  variable_key: string;
  source: string;
  variable: string;
  measure: string | null;
  level: string;
  policyengine_variables?: string[];
  policyengine_map_to?: string | null;
  policyengine_filter_variable?: string | null;
  materializer?: string | null;
  measure_mode?: string | null;
  n_targets: number;
  within_10pct: number;
  within_tolerance: number;
  mean_abs_relative_error: number | null;
}

export interface MicrocosmTargetDimension {
  key: string;
  label: string;
  values: string[];
}

export interface MicrocosmFamilyFitRow {
  family: string;
  n_targets: number;
  within_tolerance: number;
  within_10pct: number;
  mean_abs_relative_error: number | null;
}

export type MicrocosmDiagnosticsStatus = "ok" | "empty" | "incompatible";

export interface GeographyCoverageBlock {
  n_geographies?: number | null;
  household_records_min?: number | null;
  household_records_median?: number | null;
  household_records_max?: number | null;
  n_under_50?: number | null;
  n_under_100?: number | null;
  counts?: Record<string, number>;
}

export interface MicrocosmCalibration {
  available: boolean;
  diagnostics_status?: MicrocosmDiagnosticsStatus;
  dataset_role?: string | null;
  is_default?: boolean;
  is_local_area?: boolean;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  weight_entity?: string | null;
  options?: Record<string, unknown>;
  l0_lambda?: number | null;
  n_nonzero?: number | null;
  n_records?: number | null;
  geography_coverage?: {
    unit?: string;
    states?: GeographyCoverageBlock | null;
    congressional_districts?: GeographyCoverageBlock | null;
  } | null;
  initial_loss?: number | null;
  final_loss?: number | null;
  loss_kind?: "normalized_target_loss" | "raw_optimizer_objective";
  fraction_within_10pct?: number | null;
  loss_trajectory?: number[];
  skipped?: MicrocosmSkippedTarget[];
  declared_targets?: number | null;
  compiled_candidate_targets?: number | null;
  dropped_target_count?: number;
  included_target_count?: number;
  total_targets?: number;
  within_tolerance_count?: number;
  family_fit?: MicrocosmFamilyFitRow[];
}

export interface MicrocosmReleaseEntry {
  release_id: string;
  date: string;
  files: string[];
  has_calibration: boolean;
  dataset_role?: string | null;
  is_default?: boolean;
  is_local_area?: boolean;
}

export interface MicrocosmReleasesResponse {
  latest_release_id: string;
  updated_at: string | null;
  releases: MicrocosmReleaseEntry[];
  all_releases: MicrocosmReleaseEntry[];
}

export interface MicrocosmResponse {
  source_repo: string;
  repo_type: string;
  revision: string;
  source: "huggingface_live" | string;
  release_id: string;
  updated_at: string | null;
  source_artifacts: { name: string; path: string; url: string }[];
  limitations: string[];
  build_manifest: {
    build_id?: string | null;
    builder?: string | null;
    build_sha?: string | null;
    build_date?: string | null;
    dataset?: { filename?: string | null; sha256?: string | null };
    calibration?: { filename?: string | null; sha256?: string | null };
    construction?: string | null;
    gates?: MicrocosmGates;
    [key: string]: unknown;
  };
  release_manifest: {
    schema_version?: number | null;
    data_package?: { name?: string | null; version?: string | null };
    default_datasets?: Record<string, string>;
    compatible_model_packages?: { name: string; specifier: string }[];
    compatible_core_packages?: { name: string; specifier: string }[];
    build?: Record<string, unknown>;
    artifacts?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  gates: MicrocosmGates;
  calibration: MicrocosmCalibration;
  highlights: {
    worst_fit: MicrocosmTargetRow[];
    biggest_improvements: MicrocosmTargetRow[];
    worst_bounded_relative_fit?: MicrocosmTargetRow[];
    extreme_relative_outliers?: MicrocosmTargetRow[];
    extreme_relative_outlier_count?: number;
    largest_absolute_misses?: MicrocosmTargetRow[];
    biggest_relative_improvements?: MicrocosmTargetRow[];
    biggest_absolute_improvements?: MicrocosmTargetRow[];
  };
}

export interface MicrocosmTargetDiagnostics {
  available: boolean;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  metric?: string | null;
  families?: string[];
  sources?: string[];
  levels?: string[];
  geographies?: string[];
  variables?: MicrocosmVariableRow[];
  dimensions?: MicrocosmTargetDimension[];
  summary: {
    diagnostics_status?: MicrocosmDiagnosticsStatus;
    total_targets?: number | null;
    within_tolerance_count?: number | null;
    fraction_within_10pct?: number | null;
    included_target_count?: number | null;
    skipped_target_count?: number | null;
    dropped_target_count?: number | null;
    declared_targets?: number | null;
    compiled_candidate_targets?: number | null;
    [key: string]: unknown;
  };
  total_targets: number;
  filtered_total?: number;
  returned?: number;
  limit?: number;
  offset?: number;
  has_next?: boolean;
  display_limit?: number;
  filters?: Record<string, unknown>;
  targets: MicrocosmTargetRow[];
}

export interface MicrocosmComparisonRow {
  name: string;
  target_label?: string | null;
  source?: string | null;
  variable_key?: string | null;
  variable?: string | null;
  measure?: string | null;
  level?: string | null;
  breakdown?: string | null;
  dims?: string[] | null;
  target_dimensions?: {
    key: string;
    label: string;
    value: string;
    source_key?: string;
    raw_value?: string;
  }[] | null;
  geography?: string | null;
  a_target?: number | null;
  b_target?: number | null;
  a_final_estimate?: number | null;
  b_final_estimate?: number | null;
  error_kind?: "relative" | "absolute" | null;
  a_error?: number | null;
  b_error?: number | null;
  a_relative_error?: number | null;
  b_relative_error?: number | null;
  a_within_tolerance?: boolean | null;
  b_within_tolerance?: boolean | null;
  abs_rel_delta?: number | null;
}

export interface MicrocosmComparisonVariableRow {
  variable_key: string;
  source?: string | null;
  variable?: string | null;
  measure?: string | null;
  level?: string | null;
  common_targets: number;
  relative_targets: number;
  improved: number;
  regressed: number;
  unchanged: number;
  a_mean_abs_error: number | null;
  b_mean_abs_error: number | null;
  mean_abs_delta: number | null;
}

export interface MicrocosmComparison {
  a: {
    release_id: string;
    total_targets: number;
    initial_loss: number | null;
    final_loss: number | null;
    loss_kind: "normalized_target_loss" | "raw_optimizer_objective";
    fraction_within_10pct: number | null;
  };
  b: {
    release_id: string;
    total_targets: number;
    initial_loss: number | null;
    final_loss: number | null;
    loss_kind: "normalized_target_loss" | "raw_optimizer_objective";
    fraction_within_10pct: number | null;
  };
  summary: {
    common: number;
    added: number;
    removed: number;
    improved: number;
    regressed: number;
    unchanged: number;
    losses_comparable: boolean;
    loss_kind: "normalized_target_loss" | "raw_optimizer_objective" | "mixed";
  };
  variables: MicrocosmComparisonVariableRow[];
  rows: MicrocosmComparisonRow[];
}

export interface MicrocosmStagingRunSummary {
  run_id: string;
  candidate_release_id?: string | null;
  status?: string | null;
  stage?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  progress_path?: string | null;
  run_manifest_path?: string | null;
}

export interface MicrocosmStagingRunsResponse {
  available: boolean;
  source_repo: string;
  revision: string;
  detail?: string | null;
  runs: MicrocosmStagingRunSummary[];
}

export interface MicrocosmStagingRunResponse {
  available: boolean;
  source_repo: string;
  revision: string;
  run_id: string;
  candidate_release_id?: string | null;
  progress?: Record<string, unknown> | null;
  run_manifest?: Record<string, unknown> | null;
  calibration_progress?: {
    events?: {
      epoch?: number | null;
      epochs?: number | null;
      loss?: number | null;
      time?: string | null;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  } | null;
  events?: Record<string, unknown>[];
  has_calibration: boolean;
  calibration?: MicrocosmCalibration | null;
  reform_validation?: ReformValidationResponse | null;
  build_manifest?: Record<string, unknown> | null;
  release_manifest?: Record<string, unknown> | null;
}

export interface MicrocosmVariableValue {
  variable: string;
  period: string;
  release_id: string;
  dataset: string;
  entity: string;
  definition_period: string;
  label?: string | null;
  documentation?: string | null;
  value: number | null;
  weighted_sum: number | null;
  raw_sum: number | null;
  weight_sum: number | null;
  record_count: number;
  nonzero_weight_count: number | null;
  elapsed_seconds: number | null;
}

export interface MicrocosmVariableLookupResponse extends Partial<MicrocosmVariableValue> {
  period: string;
  release_id: string;
  dataset: string;
  dataset_path?: string | null;
  variables: MicrocosmVariableValue[];
  elapsed_seconds: number | null;
}

export interface CatalogVariable {
  name: string;
  label: string | null;
  entity: string | null;
  unit: string | null;
}

export function useVariableCatalog() {
  return useQuery({
    queryKey: ["variable-catalog"],
    queryFn: async (): Promise<CatalogVariable[]> => {
      const res = await fetch(withBasePath("/variable-catalog.json"));
      if (!res.ok) throw new Error("Could not load the variable catalog.");
      const data = (await res.json()) as { variables?: CatalogVariable[] };
      return data.variables ?? [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useMicrocosmVariableValue(params: {
  variables?: string[];
  period?: string;
  release?: string;
}) {
  const variables = params.variables?.map((v) => v.trim()).filter(Boolean) ?? [];
  const path =
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? "/microcosm_variable"
      : "/microcosm/variable";
  const endpointCacheKey = path === "/microcosm_variable" ? "python-hosted-v3" : "node-local-v3";
  return useQuery({
    queryKey: [
      "microcosm",
      "variable",
      endpointCacheKey,
      variables,
      params.period ?? "2024",
      params.release ?? "latest",
    ],
    queryFn: () =>
      apiGet<MicrocosmVariableLookupResponse>(path, {
        variables,
        period: params.period ?? "2024",
        release: params.release || undefined,
      }),
    enabled: variables.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

export interface ReformValidationRow {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  in_sample?: boolean;
  period?: number | null;
  // "percent" for rate backtests (fractions in the score fields); absent or
  // "currency-USD" for budget-effect rows.
  unit?: "currency-USD" | "percent" | null;
  jct_score?: number | null;
  jct_score_fy2026?: number | null;
  jct_score_type?: string | null;
  jct_window?: string | null;
  jct_benchmark_window?: string | null;
  jct_source?: string | null;
  jct_source_url?: string | null;
  jct_published?: string | null;
  microcosm_estimate?: number | null;
  microcosm_window?: string | null;
  microcosm_annual?: Record<string, number> | null;
  abs_error?: number | null;
  relative_error?: number | null;
  abs_relative_error?: number | null;
  within_10pct?: boolean | null;
  direction?: "over" | "under" | "exact" | null;
}

export interface ReformValidationResponse {
  available: boolean;
  release_id: string;
  // present when available === false
  reason?: string;
  expected_path?: string;
  // present when available === true
  updated_at?: string | null;
  schema_version?: number | null;
  baseline_period?: number | null;
  scoring_window?: string | null;
  rows?: ReformValidationRow[];
  summary?: {
    n_reforms: number;
    n_scored: number;
    within_10pct: number;
    mean_abs_relative_error: number | null;
    median_abs_relative_error: number | null;
    n_out_of_sample: number;
    n_out_of_sample_scored: number;
    out_of_sample_within_10pct: number;
    out_of_sample_mean_abs_relative_error: number | null;
  };
  source_artifact?: { name: string; path: string; url: string };
}

export function useMicrocosmCompare(a?: string, b?: string, enabled = true) {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "compare", "variables-v2", country, a, b],
    queryFn: () => apiGet<MicrocosmComparison>("/microcosm/compare", { a, b, country }),
    enabled: enabled && Boolean(a && b),
    staleTime: 15 * 60 * 1000,
  });
}

export function useMicrocosmStagingRuns() {
  return useQuery({
    queryKey: ["microcosm", "staging", "runs"],
    queryFn: () => apiGet<MicrocosmStagingRunsResponse>("/microcosm/staging/runs"),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function useMicrocosmStagingRun(runId?: string) {
  return useQuery({
    queryKey: ["microcosm", "staging", "run", runId],
    queryFn: () => apiGet<MicrocosmStagingRunResponse>("/microcosm/staging/run", { id: runId }),
    enabled: Boolean(runId),
    placeholderData: keepPreviousData,
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function useMicrocosmStagingCompare(runId?: string, release = "latest") {
  return useQuery({
    queryKey: ["microcosm", "staging", "compare", runId, release],
    queryFn: () =>
      apiGet<MicrocosmComparison & { available?: boolean; detail?: string }>(
        "/microcosm/staging/compare",
        { run: runId, release },
      ),
    enabled: Boolean(runId),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

export function useMicrocosmReleases() {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "releases", country],
    queryFn: () => apiGet<MicrocosmReleasesResponse>("/microcosm/releases", { country }),
    staleTime: 5 * 60 * 1000,
  });
}

// Non-default, experimental artifacts (microcosm#398) are flagged in the picker
// so a reviewer never mistakes a local-area build for the certified national
// release.
export function releaseRoleSuffix(entry: MicrocosmReleaseEntry): string {
  if (entry.is_local_area) return " · local area · experimental";
  if (entry.is_default === false) return " · non-default";
  return "";
}

// Release dropdown options. "Latest" resolves to the newest build, so we show
// its date/sha on the label to make clear which release it currently points at.
export function releaseSelectOptions(
  data?: MicrocosmReleasesResponse,
): { value: string; label: string }[] {
  const releases = data?.releases ?? [];
  const latest =
    (data?.latest_release_id
      ? releases.find((r) => r.release_id === data.latest_release_id)
      : undefined) ?? releases[0];
  return [
    {
      value: "",
      label: latest ? `Latest · ${releaseLabel(latest.release_id, latest.date)}` : "Latest",
    },
    ...releases.map((r) => ({
      value: r.release_id,
      label: `${releaseLabel(r.release_id, r.date)}${releaseRoleSuffix(r)}`,
    })),
  ];
}

export function useMicrocosm(release?: string) {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", country, release ?? "latest"],
    queryFn: () =>
      apiGet<MicrocosmResponse>("/microcosm", { release: release || undefined, country }),
    staleTime: 5 * 60 * 1000,
  });
}

export interface MicrocosmTreemapLeaf {
  key: string;
  source: string;
  variable: string;
  measure: string | null;
  measure_counts: { measure: string | null; n_targets: number }[];
  filters?: {
    program?: string;
    geography?: string;
    missing_geography?: true;
  };
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  huber_loss: number;
  huber_error_intensity: number | null;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
}

export interface MicrocosmTreemapGroup {
  source: string;
  label: string;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  huber_loss: number;
  huber_error_intensity: number | null;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
  children: MicrocosmTreemapLeaf[];
}

export interface MicrocosmTreemapResponse {
  release_id: string;
  total_targets: number;
  total_within_10pct: number;
  total_scored: number;
  total_loss: number;
  total_huber_loss: number;
  groups: MicrocosmTreemapGroup[];
}

export function useMicrocosmTargetTreemap(release?: string, breakdown?: "program" | "geography") {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "target-treemap", country, release ?? "latest", breakdown ?? "program"],
    queryFn: () =>
      apiGet<MicrocosmTreemapResponse>("/microcosm/target-treemap", {
        release: release || undefined,
        breakdown: breakdown || undefined,
        country,
      }),
    staleTime: 5 * 60 * 1000,
  });
}

function explorerApiParams(
  state: ExplorerState,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {
    breakdown: state.breakdown,
    geography_level: state.filters.geographyLevels,
    geography: state.filters.geographies,
    fit_band: state.filters.fitBands,
    status: state.filters.calibrationStatuses,
  };
  if (state.path.source && state.path.program) {
    result.source = state.path.source;
    result.program = state.path.program;
  }
  if (state.path.geography) {
    result.path_geography = state.path.geography;
    if (state.path.source && state.path.program) {
      for (const dimension of state.path.dimensions) {
        result[`dim.${dimension.key}`] = dimension.value;
      }
      if (state.path.target) result.target = state.path.target;
    }
  }
  return result;
}

export function useMicrocosmCalibrationTree(
  state: ExplorerState,
  release?: string,
) {
  const { country } = useCountry();
  return useQuery({
    ...microcosmCalibrationTreeQueryOptions(state, release, country),
    placeholderData: keepPreviousData,
  });
}

export function microcosmCalibrationTreeQueryOptions(
  state: ExplorerState,
  release: string | undefined,
  country: Country,
) {
  return {
    queryKey: ["microcosm", "target-tree", country, release ?? "latest", state],
    queryFn: () =>
      apiGet<CalibrationTreeResponse>("/microcosm/target-tree", {
        ...explorerApiParams(state),
        release: release || undefined,
        country,
      }),
    staleTime: 5 * 60 * 1000,
  };
}

export function useMicrocosmTargetDiagnostics(params: {
  release?: string;
  scope?: "healthcare";
  limit?: number;
  offset?: number;
  family?: string;
  variable?: string;
  measure?: string;
  program?: string;
  source?: string;
  level?: string;
  geography?: string;
  missing_geography?: string;
  state?: string;
  direction?: string;
  within_tolerance?: string;
  search?: string;
  facet?: string[];
  sort_by?: string;
  sort_dir?: string;
}) {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "target-diagnostics", country, params],
    queryFn: () =>
      apiGet<MicrocosmTargetDiagnostics>("/microcosm/target-diagnostics", { ...params, country }),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60 * 1000,
  });
}
