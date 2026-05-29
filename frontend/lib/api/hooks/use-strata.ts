import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { strataKeys } from "../query-keys";
import type { StratumDetail } from "../types";
import { useRunQueryState } from "./use-runs";

export function useStratum(stratumId: number | null) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: strataKeys.byId(dataset, run, stratumId!),
    queryFn: () => apiGet<StratumDetail>(`/strata/${stratumId}`),
    enabled: ready && stratumId !== null,
  });
}
