"use client";

import { useRunContext } from "@/lib/run-context";
import { useDatasets } from "@/lib/api/hooks/use-runs";

/**
 * Compact "you're viewing X" indicator. Keeps the user oriented about which
 * dataset/run powers the current page, now that the global RunPicker is
 * gone. Switching happens on the All Targets page.
 */
export function CurrentRunBadge() {
  const { dataset, run } = useRunContext();
  const datasetsQ = useDatasets();
  const datasetLabel =
    datasetsQ.data?.find((d) => d.id === dataset)?.label ?? dataset ?? "—";

  return (
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground space-y-0.5">
      <div>
        <span className="font-semibold text-foreground/80">Dataset</span>{" "}
        {datasetLabel}
      </div>
      <div>
        <span className="font-semibold text-foreground/80">Run</span>{" "}
        <span className="font-mono normal-case">{run ?? "—"}</span>
      </div>
    </div>
  );
}
