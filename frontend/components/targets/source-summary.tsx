"use client";

import { Skeleton, Text, formatNumber } from "@policyengine/ui-kit";
import { useSourceSummary } from "@/lib/api/hooks/use-targets";
import { useTargetFilters } from "@/lib/target-filters-context";

function pct(v: number | null, digits = 1): string {
  if (v === null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function SourceSummary() {
  const { toggleSource, filters } = useTargetFilters();
  const q = useSourceSummary();
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!q.data || q.data.sources.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
        Calibration fit by source · used targets only
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
            <th className="py-2 px-3">Source</th>
            <th className="py-2 px-3 text-right">Targets</th>
            <th className="py-2 px-3 text-right">Mean |err|</th>
            <th className="py-2 px-3 text-right">Median |err|</th>
            <th className="py-2 px-3 text-right">Within ±10%</th>
          </tr>
        </thead>
        <tbody>
          {q.data.sources.map((row) => {
            const active = filters.sources.includes(row.source);
            return (
              <tr
                key={row.source}
                className={`border-b border-border/40 cursor-pointer hover:bg-muted/40 ${
                  active ? "bg-primary/10" : ""
                }`}
                onClick={() => toggleSource(row.source)}
                title="Click to filter table to this source"
              >
                <td className="py-2 px-3 font-mono text-xs">{row.source}</td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {formatNumber(row.n_targets)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {pct(row.mean_abs_rel_error)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {pct(row.median_abs_rel_error)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {pct(row.pct_within_10pct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-3 py-1.5 text-xs text-muted-foreground">
        Click a row to filter the table.
      </div>
    </div>
  );
}
