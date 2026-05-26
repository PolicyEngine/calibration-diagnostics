"use client";

import {
  Badge,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Text,
} from "@policyengine/ui-kit";

import { useDatasets, useRuns } from "@/lib/api/hooks/use-runs";
import { useCompare as useCompareApi } from "@/lib/api/hooks/use-compare";
import { useCompareMode } from "@/lib/compare-context";
import { useRunContext } from "@/lib/run-context";

/**
 * Dataset / Run / Compare-with — one inline row so all three pickers sit
 * next to each other instead of stacking into separate cards. When a
 * compare run is picked we also surface a one-line headline-delta strip
 * below; the per-row delta lives in the All Targets table itself.
 */

function pct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function DeltaBadge({
  value,
  improveIsLower = true,
}: {
  value: number | null | undefined;
  improveIsLower?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const improved = improveIsLower ? value < 0 : value > 0;
  const variant: "success" | "error" | "secondary" =
    Math.abs(value) < 1e-6 ? "secondary" : improved ? "success" : "error";
  const sign = value > 0 ? "+" : "";
  return (
    <Badge variant={variant}>
      {sign}
      {(value * 100).toFixed(1)}pp
    </Badge>
  );
}

export function RunSelectorCard() {
  const { dataset, run, setSelection } = useRunContext();
  const { enabled: compareOn, setEnabled: setCompareOn, runB, setRunB } =
    useCompareMode();
  const datasetsQ = useDatasets();
  const runsQ = useRuns(dataset);
  const cmp = useCompareApi({
    dataset,
    runA: run,
    runB,
    topN: 5,
    enabled: compareOn && !!runB && runB !== run,
  });

  const diff = (
    av: number | null | undefined,
    bv: number | null | undefined,
  ): number | null => {
    if (av == null || bv == null) return null;
    return bv - av;
  };

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Dataset */}
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

          {/* Run (A — baseline) */}
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

          {/* Compare-with (inline, not a separate card) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompareOn(!compareOn)}
              className={`h-9 px-3 rounded-md border text-sm transition-colors ${
                compareOn
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              Compare {compareOn ? "on" : "off"}
            </button>

            {compareOn && (
              <Select
                value={runB ?? undefined}
                onValueChange={(v) => setRunB(v)}
                disabled={!dataset}
              >
                <SelectTrigger className="h-9 min-w-[320px]">
                  <SelectValue
                    placeholder={
                      runsQ.isLoading ? "Loading…" : "Pick a run to compare"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {runsQ.data
                    ?.filter((r) => r.run_id !== run)
                    .map((r) => (
                      <SelectItem key={r.run_id} value={r.run_id}>
                        {r.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Headline-delta strip — only when compare is engaged */}
        {compareOn && runB && (
          <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            {cmp.isLoading && (
              <div className="flex items-center gap-2">
                <Spinner size="sm" />
                <Text size="xs" c="dimmed">
                  Loading run B… (first load can take ~2 min; cached after
                  that)
                </Text>
              </div>
            )}
            {cmp.data && (
              <>
                <span>
                  <span className="text-muted-foreground">median |err|</span>{" "}
                  {pct(cmp.data.headline_a.median_abs_rel_error)} →{" "}
                  {pct(cmp.data.headline_b.median_abs_rel_error)}{" "}
                  <DeltaBadge
                    value={diff(
                      cmp.data.headline_a.median_abs_rel_error,
                      cmp.data.headline_b.median_abs_rel_error,
                    )}
                  />
                </span>
                <span>
                  <span className="text-muted-foreground">mean |err|</span>{" "}
                  {pct(cmp.data.headline_a.mean_abs_rel_error)} →{" "}
                  {pct(cmp.data.headline_b.mean_abs_rel_error)}{" "}
                  <DeltaBadge
                    value={diff(
                      cmp.data.headline_a.mean_abs_rel_error,
                      cmp.data.headline_b.mean_abs_rel_error,
                    )}
                  />
                </span>
                <span>
                  <span className="text-muted-foreground">within 5%</span>{" "}
                  {pct(cmp.data.headline_a.pct_within_5pct)} →{" "}
                  {pct(cmp.data.headline_b.pct_within_5pct)}{" "}
                  <DeltaBadge
                    value={diff(
                      cmp.data.headline_a.pct_within_5pct,
                      cmp.data.headline_b.pct_within_5pct,
                    )}
                    improveIsLower={false}
                  />
                </span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
