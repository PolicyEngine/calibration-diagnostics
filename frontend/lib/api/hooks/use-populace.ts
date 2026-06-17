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
  error_kind?: "relative" | "absolute" | null;
  initial_error?: number | null;
  final_error?: number | null;
  abs_error?: number | null;
  breakdown?: string | null;
  dims?: string[] | null;
  variable_key?: string | null;
  // schema v2 published registry metadata (null on v1).
  source_citation?: string | null;
  entity?: string | null;
  aggregation?: string | null;
  measure_name?: string | null;
  period?: number | null;
  estimate_warning?: string | null;
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
  fraction_within_10pct?: number | null;
  loss_trajectory?: number[];
  skipped?: PopulaceSkippedTarget[];
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
  variables?: PopulaceVariableRow[];
  dimensions?: PopulaceTargetDimension[];
  summary: {
    total_targets?: number | null;
    within_tolerance_count?: number | null;
    fraction_within_10pct?: number | null;
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
  variable_key?: string | null;
  variable?: string | null;
  breakdown?: string | null;
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

export interface PopulaceComparison {
  a: {
    release_id: string;
    total_targets: number;
    initial_loss: number | null;
    final_loss: number | null;
    fraction_within_10pct: number | null;
  };
  b: {
    release_id: string;
    total_targets: number;
    initial_loss: number | null;
    final_loss: number | null;
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
  };
  rows: PopulaceComparisonRow[];
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

export function usePopulaceVariableValue(params: {
  variables?: string[];
  period?: string;
  release?: string;
}) {
  const variables = params.variables?.map((v) => v.trim()).filter(Boolean) ?? [];
  return useQuery({
    queryKey: ["populace", "variable", variables, params.period ?? "2024", params.release ?? "latest"],
    queryFn: () =>
      apiGet<PopulaceVariableLookupResponse>("/populace/variable", {
        variables,
        period: params.period ?? "2024",
        release: params.release || undefined,
      }),
    enabled: variables.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

export function usePopulaceCompare(a?: string, b?: string, enabled = true) {
  return useQuery({
    queryKey: ["populace", "compare", a, b],
    queryFn: () => apiGet<PopulaceComparison>("/populace/compare", { a, b }),
    enabled: enabled && Boolean(a && b),
    staleTime: 15 * 60 * 1000,
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

export function usePopulaceTargetDiagnostics(params: {
  release?: string;
  limit?: number;
  offset?: number;
  family?: string;
  variable?: string;
  source?: string;
  level?: string;
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
