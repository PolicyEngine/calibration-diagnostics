import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { targetKeys } from "../query-keys";
import type { Target, PaginatedResponse } from "../types";

interface UseTargetsParams {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  variables?: string[];
  geoLevels?: string[];
  errorBuckets?: string[];
  variable?: string;            // legacy single-value (substring match)
  geoLevel?: string;            // legacy single-value
  geographicId?: string;
  stateFips?: number | number[];
  sources?: string[];
  domainVariable?: string;
  minAbsRelError?: number;
  includedOnly?: boolean;
  compareRun?: string | null;
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
        search: params.search || undefined,
        variable:
          params.variables && params.variables.length > 0
            ? params.variables
            : params.variable,
        geo_level:
          params.geoLevels && params.geoLevels.length > 0
            ? params.geoLevels
            : params.geoLevel,
        error_bucket:
          params.errorBuckets && params.errorBuckets.length > 0
            ? params.errorBuckets
            : undefined,
        source:
          params.sources && params.sources.length > 0
            ? params.sources
            : undefined,
        geographic_id: params.geographicId,
        state_fips: params.stateFips,
        domain_variable: params.domainVariable,
        min_abs_rel_error: params.minAbsRelError,
        included_only: params.includedOnly,
        compare_run: params.compareRun || undefined,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      }),
  });
}

export interface FacetValue {
  value: string;
  count: number;
  total_loss?: number;
}

export interface SourceSummaryRow {
  source: string;
  n_targets: number;
  mean_abs_rel_error: number | null;
  median_abs_rel_error: number | null;
  total_loss: number | null;
  pct_within_10pct: number | null;
}

export function useSourceSummary() {
  return useQuery({
    queryKey: ["targets", "source-summary"],
    queryFn: () =>
      apiGet<{ sources: SourceSummaryRow[] }>("/targets/source-summary"),
  });
}

export interface FacetsResponse {
  by_variable: FacetValue[];
  by_geo_level: FacetValue[];
  by_source?: FacetValue[];
  by_error_bucket: FacetValue[];
  by_status: FacetValue[];
  buckets_definition: Record<string, { min: number; max: number | null }>;
}

export function useTargetFacets(params: UseTargetsParams = {}) {
  return useQuery({
    queryKey: ["targets", "facets", params],
    queryFn: () =>
      apiGet<FacetsResponse>("/targets/facets", {
        search: params.search || undefined,
        variable: params.variables,
        geo_level: params.geoLevels,
        error_bucket: params.errorBuckets,
        included_only: params.includedOnly,
        state_fips: params.stateFips,
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
