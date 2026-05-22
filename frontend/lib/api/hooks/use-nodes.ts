import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

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
  return useQuery({
    queryKey: ["nodes"],
    queryFn: () => apiGet<NodesResponse>("/nodes"),
    staleTime: 60 * 60 * 1000,
  });
}
