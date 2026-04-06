import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import type { GeoOption } from "../types";

export function useStates() {
  return useQuery({
    queryKey: ["geography", "states"],
    queryFn: () => apiGet<GeoOption[]>("/geography/states"),
  });
}

export function useDistricts(stateFips?: number) {
  return useQuery({
    queryKey: ["geography", "districts", stateFips],
    queryFn: () =>
      stateFips
        ? apiGet<GeoOption[]>(`/geography/districts/${stateFips}`)
        : apiGet<GeoOption[]>("/geography/districts"),
    enabled: stateFips !== undefined || true,
  });
}
