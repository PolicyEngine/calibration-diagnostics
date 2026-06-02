import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

export interface MicroplexTagSummary {
  [key: string]: number | null;
}

export interface MicroplexHeadline {
  baseline_label: string | null;
  candidate_label: string | null;
  calibration_target_profile: string | null;
  n_synthetic: number | null;
  target_period: number | null;
  baseline_composite_parity_loss: number | null;
  candidate_composite_parity_loss: number | null;
  composite_parity_loss_delta: number | null;
  baseline_mean_abs_relative_error: number | null;
  candidate_mean_abs_relative_error: number | null;
  mean_abs_relative_error_delta: number | null;
  slice_win_rate: number | null;
  supported_target_rate: number | null;
  target_win_rate: number | null;
  tag_summaries: Record<string, MicroplexTagSummary>;
}

export interface MicroplexRunSummary {
  artifactPath: string;
  artifactRoot: string;
  auditAvailable: boolean;
  candidateBeatsBaseline: boolean;
  largestRegressingFamily: string | null;
  largestRegressingFamilyDelta: number | null;
  largestRegressingTarget: string | null;
  lossDelta: number | null;
  top3Families: string[];
}

export interface MicroplexNativeScores {
  available: boolean | null;
  source?: string | null;
  source_path?: string | null;
  artifact_id?: string | null;
  metric: string | null;
  period: number | null;
  baseline_enhanced_cps_native_loss: number | null;
  candidate_enhanced_cps_native_loss: number | null;
  enhanced_cps_native_loss_delta: number | null;
  baseline_unweighted_msre: number | null;
  candidate_unweighted_msre: number | null;
  unweighted_msre_delta: number | null;
  candidate_beats_baseline: boolean | null;
  n_targets_total: number | null;
  n_targets_kept: number | null;
  n_national_targets: number | null;
  n_state_targets: number | null;
  n_targets_bad_dropped: number | null;
  n_targets_zero_dropped: number | null;
  target_rows_available: boolean;
  full_target_diagnostics_path: string;
  full_target_diagnostics_manifest_key: string;
}

export interface MicroplexGeneratedArtifact {
  name: string;
  path_hint: string;
  manifest_key?: string;
  legacy_static_dashboard_path?: string;
  producer: string;
  public_committed: boolean;
  description: string;
}

export interface MicroplexNewerRuns {
  current_reader: string;
  public_branch: string;
  run_bundle_manifest_key: string;
  run_bundle_path_hint: string;
  legacy_static_dashboard_path: string;
  required_to_load_newer_runs: string;
  not_loaded_reason: string;
  configured_run_discovery: {
    artifact_root_env: string;
    single_artifact_root_env: string;
    configured_artifact_roots: string[];
    missing_artifact_roots: string[];
    detected_run_bundle_count: number;
    detected_target_diagnostics_count: number;
    latest_run_bundle: {
      artifact_id: string | null;
      artifact_dir: string;
      manifest_path: string;
      modified_at_unix: number;
      target_diagnostics_path: string | null;
      target_diagnostics_exists: boolean;
      native_scores_path: string | null;
      native_scores_exists: boolean;
    } | null;
    sampled_run_bundles: {
      artifact_id: string | null;
      artifact_dir: string;
      manifest_path: string;
      modified_at_unix: number;
      target_diagnostics_path: string | null;
      target_diagnostics_exists: boolean;
      native_scores_path: string | null;
      native_scores_exists: boolean;
    }[];
  };
}

export interface MicroplexRepoStructure {
  canonical_stage_count: number;
  current_commit_public_artifact_count: number;
  analysis_modes: string[];
  generated_artifacts: MicroplexGeneratedArtifact[];
  full_target_diagnostics: {
    available_in_committed_repo: boolean;
    expected_path: string;
    run_level_path: string;
    manifest_key: string;
    legacy_static_dashboard_path: string;
    static_dashboard_default_url: string;
    producer_command: string;
    row_fields: string[];
    primary_use: string;
  };
  run_index: {
    path_hint: string;
    query_helpers: string[];
  };
}

export interface MicroplexTargetDiagnosticRow {
  target_id?: string | null;
  target_name?: string | null;
  family?: string | null;
  target_family?: string | null;
  target_value?: number | null;
  us_data_aggregate?: number | null;
  microplex_aggregate?: number | null;
  us_data_absolute_error?: number | null;
  microplex_absolute_error?: number | null;
  us_data_relative_error?: number | null;
  microplex_relative_error?: number | null;
  delta_absolute_error?: number | null;
  delta_relative_error?: number | null;
  loss_contribution?: number | null;
  in_loss?: boolean | null;
  supported_by_microplex?: boolean | null;
  [key: string]: unknown;
}

export interface MicroplexTargetDiagnostics {
  available: boolean;
  path: string | null;
  diagnostic_schema_version?: number | null;
  metric?: string | null;
  period?: number | null;
  baseline_dataset?: string | null;
  candidate_dataset?: string | null;
  dataset_labels?: Record<string, unknown>;
  summary: Record<string, unknown>;
  total_targets: number;
  display_limit: number;
  targets: MicroplexTargetDiagnosticRow[];
}

export interface MicroplexFamilyCount {
  family: string;
  rank1Count: number;
  rank2Count: number;
  rank3Count: number;
  top3Count: number;
}

export interface MicroplexTargetCount {
  count: number;
  target: string;
  weightedTermDeltaMean?: number | null;
  weightedTermDeltaSum?: number | null;
}

export interface MicroplexFilingStatusGap {
  filingStatus: string;
  count: number;
  meanAbsWeightedCountDelta: number | null;
  negativeCount: number;
  positiveCount: number;
  weightedCountDeltaSum: number | null;
}

export interface MicroplexAgiGap {
  agiBin: string;
  count: number;
  meanAbsWeightedCountDelta: number | null;
  negativeCount: number;
  positiveCount: number;
  weightedCountDeltaSum: number | null;
}

export interface MicroplexLeadAudit {
  artifactPath: string;
  artifactRoot: string;
  largestRegressingFamily: string;
  largestRegressingTarget: string | null;
  matchingTargets: { target: string; weightedTermDelta: number }[];
}

export interface MicroplexResponse {
  source_repo: string;
  source_artifacts: { name: string; path: string; url: string }[];
  limitations: string[];
  newer_runs: MicroplexNewerRuns;
  repo_structure: MicroplexRepoStructure;
  artifact_id: string | null;
  verdict: Record<string, boolean> | null;
  headline: MicroplexHeadline;
  native_scores: MicroplexNativeScores;
  target_diagnostics: MicroplexTargetDiagnostics;
  regression_summary: {
    total_scored_runs: number | null;
    total_audited_runs: number | null;
    best_runs: MicroplexRunSummary[];
    worst_runs: MicroplexRunSummary[];
    largest_family_counts: Record<string, unknown>;
    top3_family_counts: MicroplexFamilyCount[];
    target_counts_from_audits: MicroplexTargetCount[];
  };
  irs_drilldown: {
    family: string | null;
    audits_where_family_leads: number | null;
    audits_with_matching_targets: number | null;
    lead_audits: MicroplexLeadAudit[];
    lead_target_counts: MicroplexTargetCount[];
    lead_filing_status_gap_summary: MicroplexFilingStatusGap[];
    lead_mfs_agi_gap_summary: MicroplexAgiGap[];
  };
}

export interface MicroplexReformDatasetResult {
  dataset: string;
  baseline: {
    total: number | null;
    unweighted_mean: number | null;
    record_count: number;
    weight_sum: number | null;
  };
  reform: {
    total: number | null;
    unweighted_mean: number | null;
    record_count: number;
    weight_sum: number | null;
  };
  delta: number | null;
}

export interface MicroplexReformOutcome {
  variable: string;
  entity: string;
  unit: string;
  us_data: MicroplexReformDatasetResult;
  microplex: MicroplexReformDatasetResult;
  delta_gap: number | null;
  microplex_delta_as_share_of_us_data: number | null;
}

export interface MicroplexReformComparison {
  available: boolean;
  reason?: string | null;
  runtime_seconds?: number | null;
  period: number;
  available_reforms?: {
    id: string;
    label: string;
    description: string;
    variable: string;
    entity: string;
    period: number;
    unit: string;
    source_url?: string | null;
  }[];
  reform: {
    id: string;
    label: string;
    description: string;
    source_url?: string | null;
  } | null;
  microplex_bundle?: {
    artifact_id: string | null;
    artifact_dir: string | null;
    policyengine_dataset_path: string | null;
  };
  us_data_dataset?: string | null;
  outcomes: MicroplexReformOutcome[];
}

export interface MicroplexBudgetExternalEstimate {
  source: string;
  source_type: string;
  url: string;
  estimate: number | null;
  estimate_label: string;
  period: string;
  comparable_to_live_annual_result?: boolean;
  us_data_gap?: number | null;
  us_data_ratio?: number | null;
  microplex_gap?: number | null;
  microplex_ratio?: number | null;
}

export interface MicroplexBudgetLiveResult {
  available: boolean;
  reason?: string | null;
  reform: {
    id: string;
    label: string;
    description: string;
    source_url?: string | null;
  } | null;
  period: number | null;
  outcome_variable: string | null;
  outcome_entity: string | null;
  unit: string | null;
  us_data: (MicroplexReformDatasetResult & { budget_effect: number | null }) | null;
  microplex: (MicroplexReformDatasetResult & { budget_effect: number | null }) | null;
  microplex_budget_effect_as_share_of_us_data: number | null;
  budget_effect_gap: number | null;
}

export interface MicroplexBudgetBenchmarkRow {
  id: string;
  title: string;
  policy_area: string;
  benchmark_period: string;
  comparison_status: string;
  budget_effect_rule: string;
  notes: string;
  external_estimates: MicroplexBudgetExternalEstimate[];
  live: MicroplexBudgetLiveResult;
}

export interface MicroplexBudgetBenchmarks {
  available: boolean;
  runtime_seconds?: number | null;
  generated_at_unix?: number | null;
  sign_convention: string;
  comparison_caveat: string;
  us_data_dataset: string;
  microplex_bundle: {
    available: boolean;
    artifact_id: string | null;
    artifact_dir: string | null;
    policyengine_dataset_path: string | null;
  };
  rows: MicroplexBudgetBenchmarkRow[];
  errors: { benchmark_id: string; error: string }[];
}

export function useMicroplex() {
  return useQuery({
    queryKey: ["microplex"],
    queryFn: () => apiGet<MicroplexResponse>("/microplex"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useMicroplexReformComparison(reformId?: string) {
  return useQuery({
    queryKey: ["microplex", "reform-comparison", reformId],
    queryFn: () =>
      apiGet<MicroplexReformComparison>("/microplex/reform-comparison", {
        reform_id: reformId,
      }),
    staleTime: 15 * 60 * 1000,
  });
}

export function useMicroplexBudgetBenchmarks() {
  return useQuery({
    queryKey: ["microplex", "budget-benchmarks"],
    queryFn: () =>
      apiGet<MicroplexBudgetBenchmarks>("/microplex/budget-benchmarks"),
    staleTime: 15 * 60 * 1000,
  });
}
