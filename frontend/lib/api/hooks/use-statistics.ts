import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { statisticsKeys } from "../query-keys";
import type { PovertyRate, IncomeDistribution } from "../types";

export function usePovertyRate() {
  return useQuery({
    queryKey: statisticsKeys.povertyRate(),
    queryFn: () => apiGet<PovertyRate>("/statistics/poverty-rate"),
  });
}

export function useIncomeDistribution() {
  return useQuery({
    queryKey: statisticsKeys.incomeDistribution(),
    queryFn: () =>
      apiGet<IncomeDistribution>("/statistics/income-distribution"),
  });
}
