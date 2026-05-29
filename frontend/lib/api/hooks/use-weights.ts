import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { weightKeys } from "../query-keys";
import type { WeightDistribution, HistogramBin } from "../types";
import { useRunQueryState } from "./use-runs";

interface WeightDistributionParams {
  sliceBy?: string;
  metric?: string;
  stateFips?: number;
  cdGeoid?: number;
}

export function useWeightDistribution(params: WeightDistributionParams = {}) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: weightKeys.distribution(dataset, run, params),
    queryFn: () =>
      apiGet<WeightDistribution>("/weights/distribution", {
        slice_by: params.sliceBy ?? "none",
        metric: params.metric ?? "g_weight",
        state_fips: params.stateFips,
        cd_geoid: params.cdGeoid,
      }),
    enabled: ready,
  });
}

interface HistogramParams {
  metric?: string;
  bins?: number;
  logScale?: boolean;
  filterVariable?: string;
  filterOperator?: string;
  filterValue?: number;
  stateFips?: number;
  cdGeoid?: number;
}

export function useWeightHistogram(params: HistogramParams = {}) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: weightKeys.histogram(dataset, run, params),
    queryFn: () =>
      apiGet<HistogramBin[]>("/weights/histogram", {
        metric: params.metric ?? "g_weight",
        bins: params.bins ?? 50,
        log_scale: params.logScale ?? true,
        filter_variable: params.filterVariable,
        filter_operator: params.filterOperator ?? "gt",
        filter_value: params.filterValue ?? 0,
        state_fips: params.stateFips,
        cd_geoid: params.cdGeoid,
      }),
    enabled: ready,
  });
}
