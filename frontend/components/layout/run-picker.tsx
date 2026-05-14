"use client";

import { useEffect } from "react";
import { useDatasets, useRuns } from "@/lib/api/hooks/use-runs";
import { useRunContext } from "@/lib/run-context";

/**
 * Dataset + Run dropdowns. Renders nothing until /datasets loads.
 *
 * Auto-selects the first dataset / first run if nothing is in URL yet,
 * so a cold visit to / lands on a real run instead of an empty state.
 */
export function RunPicker() {
  const { dataset, run, setSelection } = useRunContext();
  const datasetsQ = useDatasets();
  const runsQ = useRuns(dataset);

  // Auto-select first dataset on initial load.
  useEffect(() => {
    if (!dataset && datasetsQ.data && datasetsQ.data.length > 0) {
      setSelection({ dataset: datasetsQ.data[0].id, run: null });
    }
  }, [dataset, datasetsQ.data, setSelection]);

  // Auto-select first run once we have a dataset.
  useEffect(() => {
    if (dataset && !run && runsQ.data && runsQ.data.length > 0) {
      setSelection({ dataset, run: runsQ.data[0].run_id });
    }
  }, [dataset, run, runsQ.data, setSelection]);

  const selectStyles =
    "h-9 rounded-md border border-border bg-background px-2 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs uppercase tracking-wide text-muted-foreground">
        Dataset
      </label>
      <select
        className={selectStyles}
        value={dataset ?? ""}
        onChange={(e) =>
          setSelection({ dataset: e.target.value || null, run: null })
        }
        disabled={datasetsQ.isLoading}
      >
        <option value="" disabled>
          {datasetsQ.isLoading ? "Loading…" : "Select"}
        </option>
        {datasetsQ.data?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>

      <label className="text-xs uppercase tracking-wide text-muted-foreground ml-2">
        Run
      </label>
      <select
        className={selectStyles}
        value={run ?? ""}
        onChange={(e) =>
          setSelection({ dataset, run: e.target.value || null })
        }
        disabled={!dataset || runsQ.isLoading}
        title={
          runsQ.data?.find((r) => r.run_id === run)?.last_modified ?? undefined
        }
      >
        <option value="" disabled>
          {runsQ.isLoading
            ? "Loading…"
            : runsQ.data?.length === 0
              ? "No runs found"
              : "Select"}
        </option>
        {runsQ.data?.map((r) => (
          <option key={r.run_id} value={r.run_id}>
            {r.label}
            {r.last_modified ? ` — ${r.last_modified.slice(0, 10)}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
