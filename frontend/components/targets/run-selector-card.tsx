"use client";

import {
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@policyengine/ui-kit";

import { useDatasets, useRuns } from "@/lib/api/hooks/use-runs";
import { useRunContext } from "@/lib/run-context";

/**
 * Dataset + Run pickers exposed on the All Targets page. The global header
 * picker was removed; this is now the canonical place to switch what the
 * dashboard is pointing at.
 */
export function RunSelectorCard() {
  const { dataset, run, setSelection } = useRunContext();
  const datasetsQ = useDatasets();
  const runsQ = useRuns(dataset);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Dataset
            </span>
            <Select
              value={dataset ?? undefined}
              onValueChange={(v) => setSelection({ dataset: v, run: null })}
            >
              <SelectTrigger className="h-9 min-w-[220px]">
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
              <SelectTrigger className="h-9 min-w-[320px]">
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
                    {r.last_modified
                      ? ` — ${r.last_modified.slice(0, 10)}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
