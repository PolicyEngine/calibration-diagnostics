import { useQuery } from "@tanstack/react-query";
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
  initial_relative_error?: number | null;
  abs_relative_error?: number | null;
  improvement?: number | null;
  direction?: "over" | "under" | "exact" | null;
  [key: string]: unknown;
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

export interface PopulaceResponse {
  source_repo: string;
  repo_type: string;
  revision: string;
  source: "huggingface_live" | "deployed_static_snapshot" | string;
  live_unavailable_reason: string | null;
  release_id: string;
  snapshot_release_id: string;
  updated_at: string | null;
  source_artifacts: { name: string; path: string; url: string }[];
  limitations: string[];
  calibration_snapshot_stale: boolean;
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

export function usePopulace() {
  return useQuery({
    queryKey: ["populace"],
    queryFn: () => apiGet<PopulaceResponse>("/populace"),
    staleTime: 5 * 60 * 1000,
  });
}

export function usePopulaceTargetDiagnostics(params: {
  limit?: number;
  offset?: number;
  family?: string;
  state?: string;
  direction?: string;
  within_tolerance?: string;
  search?: string;
  sort_by?: string;
  sort_dir?: string;
}) {
  return useQuery({
    queryKey: ["populace", "target-diagnostics", params],
    queryFn: () =>
      apiGet<PopulaceTargetDiagnostics>("/populace/target-diagnostics", params),
    staleTime: 15 * 60 * 1000,
  });
}

export interface PopulaceComparisonSummary {
  candidate_loss: number | null;
  baseline_loss: number | null;
  loss_delta: number | null;
  candidate_holdout_loss: number | null;
  baseline_holdout_loss: number | null;
  candidate_train_loss: number | null;
  baseline_train_loss: number | null;
  candidate_unweighted_msre: number | null;
  baseline_unweighted_msre: number | null;
  candidate_wins: number | null;
  baseline_wins: number | null;
  ties: number | null;
  n_targets: number | null;
  holdout_targets: number | null;
  train_targets: number | null;
  candidate_beats_baseline: boolean | null;
  matched_household_count: number | null;
}

export interface PopulaceComparisonFamilyRow {
  family: string;
  n_targets: number | null;
  candidate_wins: number | null;
  baseline_wins: number | null;
  ties: number | null;
  candidate_loss_contribution: number | null;
  baseline_loss_contribution: number | null;
  loss_delta: number | null;
  [key: string]: unknown;
}

export interface PopulaceComparisonMover {
  target_name?: string | null;
  family?: string | null;
  split?: string | null;
  candidate_relative_error?: number | null;
  baseline_relative_error?: number | null;
  loss_delta?: number | null;
  [key: string]: unknown;
}

export interface PopulaceComparison {
  available: boolean;
  source: string;
  path: string | null;
  archived: boolean;
  live_scorecard_configured: boolean;
  live_scorecard_error: string | null;
  release_id: string | null;
  incumbent_manifest: string | null;
  period: number | null;
  baseline_label: string;
  candidate_label: string;
  protocol: string | null;
  summary: PopulaceComparisonSummary;
  family_breakdown: PopulaceComparisonFamilyRow[];
  top_improvements: PopulaceComparisonMover[];
  top_regressions: PopulaceComparisonMover[];
  gates: Record<string, unknown>;
  notes: string[];
}

export function usePopulaceComparison() {
  return useQuery({
    queryKey: ["populace", "comparison"],
    queryFn: () => apiGet<PopulaceComparison>("/populace/comparison"),
    staleTime: 15 * 60 * 1000,
  });
}
