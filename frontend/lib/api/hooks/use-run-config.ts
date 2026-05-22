import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

export interface RunConfigResponse {
  dataset_id: string;
  run_id: string;
  fit_scope: "regional" | "national";
  config: Record<string, unknown>;
}

export function useRunConfig() {
  return useQuery({
    queryKey: ["run-config"],
    queryFn: () => apiGet<RunConfigResponse>("/run-config"),
    staleTime: 5 * 60 * 1000,
    // 404 is expected for pkl-mode runs; don't auto-retry.
    retry: false,
  });
}
