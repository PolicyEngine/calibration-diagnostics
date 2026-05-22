"use client";

import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@policyengine/ui-kit";

import { useDatasets, useRuns } from "@/lib/api/hooks/use-runs";
import { useRunContext } from "@/lib/run-context";

/**
 * Dataset + Run dropdowns. Uses the ui-kit Radix-backed Select so the menu
 * is portal-rendered (escapes any container clipping or z-index issues) and
 * keeps prior options visible during background refetches — native <select>
 * flickered disabled on every query invalidation, which made it look broken.
 *
 * Auto-selects the first dataset / first run if nothing is in URL yet, so a
 * cold visit lands on a real run instead of an empty state.
 */
export function RunPicker() {
  const { dataset, run, setSelection } = useRunContext();
  const datasetsQ = useDatasets();
  const runsQ = useRuns(dataset);

  useEffect(() => {
    if (!dataset && datasetsQ.data && datasetsQ.data.length > 0) {
      setSelection({ dataset: datasetsQ.data[0].id, run: null });
    }
  }, [dataset, datasetsQ.data, setSelection]);

  useEffect(() => {
    if (dataset && !run && runsQ.data && runsQ.data.length > 0) {
      setSelection({ dataset, run: runsQ.data[0].run_id });
    }
  }, [dataset, run, runsQ.data, setSelection]);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Dataset
        </span>
        <Select
          value={dataset ?? undefined}
          onValueChange={(v) => setSelection({ dataset: v, run: null })}
        >
          <SelectTrigger className="h-9 min-w-[200px]">
            <SelectValue
              placeholder={datasetsQ.isLoading ? "Loading…" : "Select"}
            />
          </SelectTrigger>
          <SelectContent>
            {datasetsQ.data?.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Run
        </span>
        <Select
          value={run ?? undefined}
          onValueChange={(v) => setSelection({ dataset, run: v })}
          disabled={!dataset}
        >
          <SelectTrigger className="h-9 min-w-[260px]">
            <SelectValue
              placeholder={
                runsQ.isLoading
                  ? "Loading…"
                  : runsQ.data?.length === 0
                    ? "No runs"
                    : "Select"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {runsQ.data?.map((r) => (
              <SelectItem key={r.run_id} value={r.run_id}>
                {r.label}
                {r.last_modified ? ` — ${r.last_modified.slice(0, 10)}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
