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
  artifact_id: string | null;
  verdict: Record<string, boolean> | null;
  headline: MicroplexHeadline;
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

export function useMicroplex() {
  return useQuery({
    queryKey: ["microplex"],
    queryFn: () => apiGet<MicroplexResponse>("/microplex"),
    staleTime: 5 * 60 * 1000,
  });
}
