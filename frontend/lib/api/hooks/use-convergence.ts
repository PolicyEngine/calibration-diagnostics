import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { epochKeys } from "../query-keys";
import type { EpochSummaryRow, TargetEpochTrace } from "../types";

export function useEpochSummary(groupBy: string = "variable") {
  return useQuery({
    queryKey: epochKeys.summary(groupBy),
    queryFn: () =>
      apiGet<EpochSummaryRow[]>("/epochs/summary", { group_by: groupBy }),
  });
}

interface TracesParams {
  targetIndices?: string;
  variable?: string;
}

export function useEpochTraces(params: TracesParams) {
  return useQuery({
    queryKey: epochKeys.traces(params),
    queryFn: () =>
      apiGet<TargetEpochTrace[]>("/epochs/traces", {
        target_indices: params.targetIndices,
        variable: params.variable,
      }),
    enabled: !!(params.targetIndices || params.variable),
  });
}
