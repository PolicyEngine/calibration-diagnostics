import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

export interface CompareHeadline {
  n_total: number;
  n_included: number;
  n_with_estimate: number;
  median_abs_rel_error: number | null;
  mean_abs_rel_error: number | null;
  p95_abs_rel_error: number | null;
  pct_within_5pct: number | null;
  pct_within_10pct: number | null;
  pct_within_25pct: number | null;
}

export interface CompareMover {
  target_id: number;
  variable: string;
  geo_level: string;
  geographic_id: string | null;
  value: number | null;
  estimate_a: number | null;
  estimate_b: number | null;
  rel_error_a: number | null;
  rel_error_b: number | null;
  abs_rel_error_a: number | null;
  abs_rel_error_b: number | null;
  delta: number;
}

export interface CompareVariableRollup {
  variable: string;
  n_targets: number;
  mean_abs_rel_error_a: number;
  mean_abs_rel_error_b: number;
  mean_delta: number;
  n_improved: number;
  n_regressed: number;
}

export interface CompareResponse {
  dataset: string;
  run_a: string;
  run_b: string;
  headline_a: CompareHeadline;
  headline_b: CompareHeadline;
  movers: { improved: CompareMover[]; regressed: CompareMover[] };
  by_variable: CompareVariableRollup[];
}

export function useCompare(opts: {
  dataset: string | null;
  runA: string | null;
  runB: string | null;
  topN?: number;
  enabled?: boolean;
}) {
  const { dataset, runA, runB, topN = 25, enabled = true } = opts;
  return useQuery({
    queryKey: ["compare", dataset, runA, runB, topN],
    queryFn: () =>
      apiGet<CompareResponse>("/compare", {
        dataset: dataset!,
        run_a: runA!,
        run_b: runB!,
        top_n: topN,
      }),
    enabled: enabled && !!dataset && !!runA && !!runB && runA !== runB,
    staleTime: 5 * 60 * 1000,
    // Loading two runs can take ~2 minutes; don't auto-retry on transient
    // timeouts.
    retry: false,
  });
}
