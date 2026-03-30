import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { weightKeys } from "../query-keys";
import type { WeightDistribution, HistogramBin } from "../types";

interface WeightDistributionParams {
  sliceBy?: string;
  metric?: string;
}

export function useWeightDistribution(params: WeightDistributionParams = {}) {
  return useQuery({
    queryKey: weightKeys.distribution(params),
    queryFn: () =>
      apiGet<WeightDistribution>("/weights/distribution", {
        slice_by: params.sliceBy ?? "none",
        metric: params.metric ?? "g_weight",
      }),
  });
}

interface HistogramParams {
  metric?: string;
  bins?: number;
  logScale?: boolean;
  filterVariable?: string;
  filterOperator?: string;
  filterValue?: number;
}

export function useWeightHistogram(params: HistogramParams = {}) {
  return useQuery({
    queryKey: weightKeys.histogram(params),
    queryFn: () =>
      apiGet<HistogramBin[]>("/weights/histogram", {
        metric: params.metric ?? "g_weight",
        bins: params.bins ?? 50,
        log_scale: params.logScale ?? true,
        filter_variable: params.filterVariable,
        filter_operator: params.filterOperator ?? "gt",
        filter_value: params.filterValue ?? 0,
      }),
  });
}
