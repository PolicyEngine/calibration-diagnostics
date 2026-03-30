import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { strataKeys } from "../query-keys";
import type { StratumDetail } from "../types";

export function useStratum(stratumId: number | null) {
  return useQuery({
    queryKey: strataKeys.byId(stratumId!),
    queryFn: () => apiGet<StratumDetail>(`/strata/${stratumId}`),
    enabled: stratumId !== null,
  });
}
