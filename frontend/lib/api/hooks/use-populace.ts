import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

export interface PopulaceReleaseEntry {
  release_id: string;
  files: string[];
}

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

export interface PopulaceScoreVsEnhancedCps {
  protocol?: string | null;
  train_loss?: Record<string, number | null>;
  holdout_loss?: Record<string, number | null>;
  full_loss?: Record<string, number | null>;
  per_target_wins?: Record<string, number | null>;
}

export interface PopulaceFamilyBreakdownRow {
  family: string;
  n_targets: number | null;
  train_targets?: number | null;
  holdout_targets?: number | null;
  baseline_wins?: number | null;
  candidate_wins?: number | null;
  ties?: number | null;
  baseline_loss_contribution?: number | null;
  candidate_loss_contribution?: number | null;
  loss_delta?: number | null;
  [key: string]: unknown;
}

export interface PopulaceTargetDiagnosticRow {
  target_name?: string | null;
  target_index?: number | null;
  target_value?: number | null;
  family?: string | null;
  split?: "train" | "holdout" | string | null;
  winner?: "candidate" | "baseline" | "tie" | string | null;
  value_scale?: string | null;
  baseline_estimate?: number | null;
  baseline_error?: number | null;
  baseline_relative_error?: number | null;
  baseline_loss_term?: number | null;
  baseline_abs_scaled_error?: number | null;
  candidate_estimate?: number | null;
  candidate_error?: number | null;
  candidate_relative_error?: number | null;
  candidate_loss_term?: number | null;
  candidate_abs_scaled_error?: number | null;
  loss_delta?: number | null;
  [key: string]: unknown;
}

export interface PopulaceComparisonSummary {
  available: boolean;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  period?: number | null;
  metric?: string | null;
  elapsed_seconds?: number | null;
  summary?: Record<string, unknown>;
  matched_datasets?: Record<string, unknown>;
  refit_config?: Record<string, unknown>;
  comparison_contract?: Record<string, unknown>;
  target_split?: {
    holdout_target_fraction?: number | null;
    holdout_target_seed?: number | null;
    holdout_targets?: number | null;
    train_targets?: number | null;
  };
  score_broad_loss?: Record<string, unknown>;
  score_family_breakdown?: Record<string, unknown>[];
  target_diagnostics_summary?: Record<string, unknown>;
  family_breakdown?: PopulaceFamilyBreakdownRow[];
  top_improvements?: PopulaceTargetDiagnosticRow[];
  top_regressions?: PopulaceTargetDiagnosticRow[];
}

export interface PopulaceTargetDiagnostics {
  available: boolean;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  metric?: string | null;
  period?: number | null;
  baseline_label?: string | null;
  candidate_label?: string | null;
  summary: Record<string, unknown>;
  total_targets: number;
  display_limit?: number;
  families?: string[];
  filtered_total?: number;
  returned?: number;
  limit?: number;
  offset?: number;
  has_next?: boolean;
  filters?: Record<string, unknown>;
  targets: PopulaceTargetDiagnosticRow[];
}

export interface PopulaceResponse {
  source_repo: string;
  repo_type: string;
  revision: string;
  source: "huggingface_live" | "deployed_static_snapshot" | string;
  live_unavailable_reason: string | null;
  release_id: string;
  snapshot_release_id: string;
  releases: PopulaceReleaseEntry[];
  source_artifacts: { name: string; path: string; url: string }[];
  limitations: string[];
  comparison_snapshot_stale: boolean;
  build_manifest: {
    build_id?: string | null;
    builder?: string | null;
    build_sha?: string | null;
    build_date?: string | null;
    dataset?: { filename?: string | null; sha256?: string | null };
    calibration?: { filename?: string | null; sha256?: string | null };
    construction?: string | null;
    gates?: PopulaceGates;
    score_vs_enhanced_cps?: PopulaceScoreVsEnhancedCps;
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
  score_vs_enhanced_cps: PopulaceScoreVsEnhancedCps;
  comparison: PopulaceComparisonSummary;
  target_diagnostics: PopulaceTargetDiagnostics;
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
  split?: string;
  winner?: string;
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
