import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import type { GeoOption } from "../types";
import { useRunQueryState } from "./use-runs";

export function useStates() {
  return useQuery({
    queryKey: ["geography", "states"],
    queryFn: () => apiGet<GeoOption[]>("/geography/states"),
  });
}

export function useDistricts(stateFips?: number) {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: ["geography", dataset, run, "districts", stateFips],
    queryFn: () =>
      stateFips
        ? apiGet<GeoOption[]>(`/geography/districts/${stateFips}`)
        : apiGet<GeoOption[]>("/geography/districts"),
    enabled: ready,
  });
}
