import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useCountry } from "@/components/layout/country-context";
import { LATEST_RELEASE_STALE_TIME_MS } from "@/lib/api/cache-policy";
import { withBasePath } from "@/lib/base-path";
import type {
  ReleaseHistoryPanelView,
  ReleaseHistorySummary,
} from "@/lib/microcosm/release-history-summary";

import { apiGet } from "../client";

// The release history page's two reads (calibration-diagnostics#224). Both documents change at
// each run, so they are refetched after a minute like the other "latest" reads.

/** The country's panels, one per reference engine, and the panel the page opens. */
export function useReleaseHistorySummary() {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "release-history", country],
    queryFn: () => apiGet<ReleaseHistorySummary>("/microcosm/release-history", { country }),
    staleTime: LATEST_RELEASE_STALE_TIME_MS,
  });
}

/**
 * One panel's timeline. While another engine's panel loads, the page keeps the one it shows, so
 * the engine toggle never empties it.
 */
export function useReleaseHistoryPanel(panelId: string | null, enabled: boolean) {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "release-history-panel", country, panelId ?? "default"],
    queryFn: () =>
      apiGet<ReleaseHistoryPanelView>("/microcosm/release-history/timeline", {
        country,
        panel: panelId ?? undefined,
      }),
    staleTime: LATEST_RELEASE_STALE_TIME_MS,
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** Where a panel's table downloads from, as a CSV. */
export function releaseHistoryExportUrl(country: string, panelId: string): string {
  const params = new URLSearchParams({ country, panel: panelId });
  return withBasePath(`/api/microcosm/release-history/export?${params.toString()}`);
}
