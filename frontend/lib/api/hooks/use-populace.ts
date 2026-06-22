import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

export interface PopulaceGates {
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

export interface PopulaceSkippedTarget {
  name: string;
  reason: string;
}

export interface PopulaceTargetRow {
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
  ledger?: {
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

export interface PopulaceVariableRow {
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

export interface PopulaceTargetDimension {
  key: string;
  label: string;
  values: string[];
}

export interface PopulaceFamilyFitRow {
  family: string;
  n_targets: number;
  within_tolerance: number;
  within_10pct: number;
  mean_abs_relative_error: number | null;
}

export interface PopulaceCalibration {
  available: boolean;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  weight_entity?: string | null;
  options?: Record<string, unknown>;
  l0_lambda?: number | null;
  n_nonzero?: number | null;
  n_records?: number | null;
  initial_loss?: number | null;
  final_loss?: number | null;
  loss_kind?: "normalized_target_loss" | "raw_optimizer_objective";
  fraction_within_10pct?: number | null;
  loss_trajectory?: number[];
  skipped?: PopulaceSkippedTarget[];
  declared_targets?: number | null;
  compiled_candidate_targets?: number | null;
  dropped_target_count?: number;
  included_target_count?: number;
  total_targets?: number;
  within_tolerance_count?: number;
  family_fit?: PopulaceFamilyFitRow[];
}

export interface PopulaceReleaseEntry {
  release_id: string;
  date: string;
  files: string[];
  has_calibration: boolean;
}

export interface PopulaceReleasesResponse {
  latest_release_id: string;
  updated_at: string | null;
  releases: PopulaceReleaseEntry[];
  all_releases: PopulaceReleaseEntry[];
}

export interface PopulaceResponse {
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
    gates?: PopulaceGates;
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
  gates: PopulaceGates;
  calibration: PopulaceCalibration;
  highlights: {
    worst_fit: PopulaceTargetRow[];
    biggest_improvements: PopulaceTargetRow[];
    worst_bounded_relative_fit?: PopulaceTargetRow[];
    extreme_relative_outliers?: PopulaceTargetRow[];
    extreme_relative_outlier_count?: number;
    largest_absolute_misses?: PopulaceTargetRow[];
    biggest_relative_improvements?: PopulaceTargetRow[];
    biggest_absolute_improvements?: PopulaceTargetRow[];
  };
}

export interface PopulaceTargetDiagnostics {
  available: boolean;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  metric?: string | null;
  families?: string[];
  sources?: string[];
  levels?: string[];
  geographies?: string[];
  variables?: PopulaceVariableRow[];
  dimensions?: PopulaceTargetDimension[];
  summary: {
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
  targets: PopulaceTargetRow[];
}

export interface PopulaceComparisonRow {
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

export interface PopulaceComparisonVariableRow {
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

export interface PopulaceComparison {
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
  variables: PopulaceComparisonVariableRow[];
  rows: PopulaceComparisonRow[];
}

export interface PopulaceStagingRunSummary {
  run_id: string;
  candidate_release_id?: string | null;
  status?: string | null;
  stage?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  progress_path?: string | null;
  run_manifest_path?: string | null;
}

export interface PopulaceStagingRunsResponse {
  available: boolean;
  source_repo: string;
  revision: string;
  runs: PopulaceStagingRunSummary[];
}

export interface PopulaceStagingRunResponse {
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
  calibration?: PopulaceCalibration | null;
  reform_validation?: ReformValidationResponse | null;
  build_manifest?: Record<string, unknown> | null;
  release_manifest?: Record<string, unknown> | null;
}

export interface PopulaceVariableValue {
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

export interface PopulaceVariableLookupResponse extends Partial<PopulaceVariableValue> {
  period: string;
  release_id: string;
  dataset: string;
  dataset_path?: string | null;
  variables: PopulaceVariableValue[];
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
      const res = await fetch("/variable-catalog.json");
      if (!res.ok) throw new Error("Could not load the variable catalog.");
      const data = (await res.json()) as { variables?: CatalogVariable[] };
      return data.variables ?? [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function usePopulaceVariableValue(params: {
  variables?: string[];
  period?: string;
  release?: string;
}) {
  const variables = params.variables?.map((v) => v.trim()).filter(Boolean) ?? [];
  const path =
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? "/populace_variable"
      : "/populace/variable";
  const endpointCacheKey = path === "/populace_variable" ? "python-hosted-v3" : "node-local-v3";
  return useQuery({
    queryKey: [
      "populace",
      "variable",
      endpointCacheKey,
      variables,
      params.period ?? "2024",
      params.release ?? "latest",
    ],
    queryFn: () =>
      apiGet<PopulaceVariableLookupResponse>(path, {
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
  jct_score?: number | null;
  jct_score_type?: string | null;
  jct_window?: string | null;
  jct_source?: string | null;
  jct_source_url?: string | null;
  jct_published?: string | null;
  populace_estimate?: number | null;
  populace_window?: string | null;
  populace_annual?: Record<string, number> | null;
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
  category?: string | null;
  in_sample?: boolean;
  jct_score?: number | null;
  jct_source?: string | null;
  points: ReformHistoryPoint[];
  latest_abs_relative_error: number | null;
  delta: number | null;
}

export interface ReformHistoryResponse {
  releases: { release_id: string; date: string }[];
  reforms: ReformHistorySeries[];
}

export function usePopulaceReforms(release?: string) {
  return useQuery({
    queryKey: ["populace", "reforms", release ?? "latest"],
    queryFn: () =>
      apiGet<ReformValidationResponse>("/populace/reforms", release ? { release } : undefined),
    staleTime: 15 * 60 * 1000,
  });
}

export function usePopulaceReformHistory() {
  return useQuery({
    queryKey: ["populace", "reforms", "history"],
    queryFn: () => apiGet<ReformHistoryResponse>("/populace/reforms/history"),
    staleTime: 15 * 60 * 1000,
  });
}

export function usePopulaceCompare(a?: string, b?: string, enabled = true) {
  return useQuery({
    queryKey: ["populace", "compare", "variables-v2", a, b],
    queryFn: () => apiGet<PopulaceComparison>("/populace/compare", { a, b }),
    enabled: enabled && Boolean(a && b),
    staleTime: 15 * 60 * 1000,
  });
}

export function usePopulaceStagingRuns() {
  return useQuery({
    queryKey: ["populace", "staging", "runs"],
    queryFn: () => apiGet<PopulaceStagingRunsResponse>("/populace/staging/runs"),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function usePopulaceStagingRun(runId?: string) {
  return useQuery({
    queryKey: ["populace", "staging", "run", runId],
    queryFn: () => apiGet<PopulaceStagingRunResponse>("/populace/staging/run", { id: runId }),
    enabled: Boolean(runId),
    placeholderData: keepPreviousData,
    staleTime: 10 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function usePopulaceStagingCompare(runId?: string, release = "latest") {
  return useQuery({
    queryKey: ["populace", "staging", "compare", runId, release],
    queryFn: () =>
      apiGet<PopulaceComparison & { available?: boolean; detail?: string }>(
        "/populace/staging/compare",
        { run: runId, release },
      ),
    enabled: Boolean(runId),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
}

export function usePopulaceReleases() {
  return useQuery({
    queryKey: ["populace", "releases"],
    queryFn: () => apiGet<PopulaceReleasesResponse>("/populace/releases"),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePopulace(release?: string) {
  return useQuery({
    queryKey: ["populace", release ?? "latest"],
    queryFn: () => apiGet<PopulaceResponse>("/populace", release ? { release } : undefined),
    staleTime: 5 * 60 * 1000,
  });
}

export interface PopulaceTreemapLeaf {
  key: string;
  source: string;
  variable: string;
  measure: string | null;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
}

export interface PopulaceTreemapGroup {
  source: string;
  label: string;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
  children: PopulaceTreemapLeaf[];
}

export interface PopulaceTreemapResponse {
  release_id: string;
  total_targets: number;
  total_within_10pct: number;
  total_scored: number;
  total_loss: number;
  groups: PopulaceTreemapGroup[];
}

export function usePopulaceTargetTreemap(release?: string) {
  return useQuery({
    queryKey: ["populace", "target-treemap", release ?? "latest"],
    queryFn: () =>
      apiGet<PopulaceTreemapResponse>(
        "/populace/target-treemap",
        release ? { release } : undefined,
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePopulaceTargetDiagnostics(params: {
  release?: string;
  scope?: "healthcare";
  limit?: number;
  offset?: number;
  family?: string;
  variable?: string;
  source?: string;
  level?: string;
  geography?: string;
  state?: string;
  direction?: string;
  within_tolerance?: string;
  search?: string;
  facet?: string[];
  sort_by?: string;
  sort_dir?: string;
}) {
  return useQuery({
    queryKey: ["populace", "target-diagnostics", params],
    queryFn: () =>
      apiGet<PopulaceTargetDiagnostics>("/populace/target-diagnostics", params),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60 * 1000,
  });
}
