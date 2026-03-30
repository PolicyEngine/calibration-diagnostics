import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { householdKeys } from "../query-keys";
import type { Household, HouseholdProfile, Attribution } from "../types";

interface DistortedParams {
  minGWeight?: number;
  filterVariable?: string;
  filterOperator?: string;
  filterValue?: number;
  state?: number;
  sortBy?: string;
  limit?: number;
  offset?: number;
}

export function useDistortedHouseholds(params: DistortedParams = {}) {
  return useQuery({
    queryKey: householdKeys.distorted(params),
    queryFn: () =>
      apiGet<Household[]>("/households/distorted", {
        min_g_weight: params.minGWeight ?? 5.0,
        filter_variable: params.filterVariable,
        filter_operator: params.filterOperator ?? "gt",
        filter_value: params.filterValue ?? 0,
        state: params.state,
        sort_by: params.sortBy ?? "g_weight",
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      }),
  });
}

export function useHouseholdProfile(
  householdIdx: number | null,
  variables?: string[],
) {
  return useQuery({
    queryKey: householdKeys.profile(householdIdx!, variables),
    queryFn: () =>
      apiGet<HouseholdProfile>(`/households/${householdIdx}/profile`, {
        variables: variables?.join(","),
      }),
    enabled: householdIdx !== null,
  });
}

export function useHouseholdAttributions(householdIdx: number | null) {
  return useQuery({
    queryKey: householdKeys.attributions(householdIdx!),
    queryFn: () =>
      apiGet<Attribution[]>(`/households/${householdIdx}/attributions`),
    enabled: householdIdx !== null,
  });
}
