import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { useRunQueryState } from "./use-runs";

export interface SummaryHeadline {
  dataset_id: string;
  run_id: string;
  n_targets: number;
  n_targets_included: number;
  n_targets_with_estimate?: number;
  median_abs_rel_error: number | null;
  mean_abs_rel_error: number | null;
  p95_abs_rel_error: number | null;
  pct_within_5pct: number | null;
  pct_within_10pct: number | null;
  pct_within_25pct: number | null;
  total_loss: number;
  n_households: number;
  time_period: number;
}

export interface ErrorBin {
  bin_min: number;
  bin_max: number;
  count: number;
  overflow?: boolean;
}

export interface GroupRow {
  group: string;
  n_targets: number;
  mean_abs_rel_error: number | null;
  median_abs_rel_error: number | null;
  total_loss: number | null;
}

export interface WorstTargetRow {
  target_idx: number;
  target_name: string;
  variable: string;
  geo_level: string | null;
  value: number;
  estimate: number | null;
  rel_error: number | null;
  abs_rel_error: number | null;
  loss_contribution: number | null;
}

export interface WeightHealth {
  n_households: number;
  pct_zero_g: number | null;
  pct_negative_final: number | null;
  pct_extreme_g_high: number | null;
  pct_extreme_g_low: number | null;
  g_median: number | null;
  g_p95: number | null;
  g_p5: number | null;
}

export interface SummaryResponse {
  headline: SummaryHeadline;
  error_distribution: ErrorBin[];
  worst_by_variable: GroupRow[];
  worst_by_geo_level: GroupRow[];
  worst_targets: WorstTargetRow[];
  weight_health: WeightHealth;
}

export function useSummary() {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: ["summary", dataset, run],
    queryFn: () => apiGet<SummaryResponse>("/summary"),
    enabled: ready,
  });
}
