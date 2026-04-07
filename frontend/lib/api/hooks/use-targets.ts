import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { targetKeys } from "../query-keys";
import type { Target, PaginatedResponse } from "../types";

interface UseTargetsParams {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  variable?: string;
  geoLevel?: string;
  geographicId?: string;
  stateFips?: number;
  domainVariable?: string;
  minAbsRelError?: number;
  includedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function useTargets(params: UseTargetsParams = {}) {
  return useQuery({
    queryKey: targetKeys.list(params),
    queryFn: () =>
      apiGet<PaginatedResponse<Target>>("/targets", {
        sort_by: params.sortBy ?? "loss_contribution",
        sort_order: params.sortOrder ?? "desc",
        variable: params.variable,
        geo_level: params.geoLevel,
        geographic_id: params.geographicId,
        state_fips: params.stateFips,
        domain_variable: params.domainVariable,
        min_abs_rel_error: params.minAbsRelError,
        included_only: params.includedOnly,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      }),
  });
}

export function useTargetSearch(variable: string, enabled = true) {
  return useQuery({
    queryKey: targetKeys.search(variable),
    queryFn: () =>
      apiGet<Target[]>("/targets/search", { variable }),
    enabled: enabled && variable.length >= 2,
  });
}

export function useWorstFitTargets(limit = 20) {
  return useQuery({
    queryKey: targetKeys.worstFit(),
    queryFn: () =>
      apiGet<Target[]>("/targets/worst-fit", { limit }),
  });
}
