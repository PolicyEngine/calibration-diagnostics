import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { targetKeys } from "../query-keys";
import type { Target, PaginatedResponse } from "../types";

interface UseTargetsParams {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  variable?: string;
  geoLevel?: string;
  domainVariable?: string;
  minAbsRelError?: number;
  limit?: number;
  offset?: number;
}

export function useTargets(params: UseTargetsParams = {}) {
  return useQuery({
    queryKey: targetKeys.list(params),
    queryFn: () =>
      apiGet<PaginatedResponse<Target>>("/targets", {
        sort_by: params.sortBy ?? "pull_score",
        sort_order: params.sortOrder ?? "desc",
        variable: params.variable,
        geo_level: params.geoLevel,
        domain_variable: params.domainVariable,
        min_abs_rel_error: params.minAbsRelError,
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

export function useTargetPovertyImpact(limit = 20) {
  return useQuery({
    queryKey: targetKeys.povertyImpact(),
    queryFn: () =>
      apiGet<Target[]>("/targets/poverty-impact", { limit }),
  });
}
