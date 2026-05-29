import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";
import { useRunQueryState } from "./use-runs";

export interface NodeVariable {
  name: string;
  label: string;
  entity: string;
  value_type: string;
  definition_period: string | null;
  documentation: string | null;
  is_calibrated: boolean;
}

export interface NodesResponse {
  items: NodeVariable[];
  total: number;
  n_calibrated: number;
}

export function useNodes() {
  const { dataset, run, ready } = useRunQueryState();
  return useQuery({
    queryKey: ["nodes", dataset, run],
    queryFn: () => apiGet<NodesResponse>("/nodes"),
    enabled: ready,
    staleTime: 60 * 60 * 1000,
  });
}
