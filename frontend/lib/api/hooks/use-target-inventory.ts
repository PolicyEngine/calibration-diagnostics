import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../client";

export interface InventoryRow {
  variable: string;
  geo_level: string | null;
  geographic_id: string | null;
  period: number | null;
  constraints: [string, string, string][];
  value: number | null;
  is_count: boolean;
  storage_tier: "db" | "csv" | "python" | "generator" | "yaml";
  source_path: string;
  source_row: string;
  notes: string;
  in_db: boolean;
  estimate: number | null;
  rel_error: number | null;
  target_idx: number | null;
}

export interface InventoryListResponse {
  items: InventoryRow[];
  total: number;
  offset: number;
  limit: number;
}

export interface InventorySummaryTier {
  tier: string;
  total_records: number;
  unique_signatures: number;
  matched_to_db: number;
  unmatched: number;
  match_rate: number | null;
  unmatched_examples: Record<string, unknown>[];
}

export interface InventorySummary {
  db_total: number;
  tiers: InventorySummaryTier[];
  parsers_covered: string[];
  parsers_missing: string[];
}

export function useTargetInventorySummary() {
  return useQuery({
    queryKey: ["target-inventory", "summary"],
    queryFn: () => apiGet<InventorySummary>("/target-inventory/summary"),
    staleTime: 60 * 60 * 1000,
  });
}

interface ListParams {
  tier?: string;
  source_path?: string;
  variable?: string;
  in_db?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useTargetInventory(params: ListParams = {}) {
  return useQuery({
    queryKey: ["target-inventory", "list", params],
    queryFn: () =>
      apiGet<InventoryListResponse>("/target-inventory", {
        tier: params.tier,
        source_path: params.source_path,
        variable: params.variable,
        in_db: params.in_db,
        search: params.search,
        limit: params.limit ?? 100,
        offset: params.offset ?? 0,
      }),
  });
}
