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
  Text,
} from "@policyengine/ui-kit";

import { useCompare as useCompareApi } from "@/lib/api/hooks/use-compare";
import { useRuns } from "@/lib/api/hooks/use-runs";
import { useCompareMode } from "@/lib/compare-context";
import { useRunContext } from "@/lib/run-context";

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

/**
 * Compact bar at the top of /targets when compare mode is on. Shows the
 * Run-B picker and the headline deltas — nothing more. The per-row diff
 * lives in the main table itself (estimate_b / Δ columns), so the user
 * can sort & filter just like in single-run mode.
 */
export function CompareBar() {
  const { enabled, setEnabled, runB, setRunB } = useCompareMode();
  const { dataset, run } = useRunContext();
  const runsQ = useRuns(dataset);
  const cmp = useCompareApi({
    dataset,
    runA: run,
    runB,
    topN: 5,
    enabled: enabled && !!runB && runB !== run,
  });

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={() => setEnabled(!enabled)}
            className={`h-8 px-3 rounded-md border text-sm transition-colors ${
              enabled
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            Compare {enabled ? "on" : "off"}
          </button>

          {enabled && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  A
                </span>
                <span className="font-mono text-xs">{run ?? "—"}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  B
                </span>
                <Select
                  value={runB ?? undefined}
                  onValueChange={(v) => setRunB(v)}
                  disabled={!dataset}
                >
                  <SelectTrigger className="h-8 min-w-[320px]">
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
              </div>

              {runB && cmp.isLoading && (
                <Text size="xs" c="dimmed">
                  Loading run B… (first load can take ~2 min)
                </Text>
              )}
              {runB && cmp.data && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span>
                    <span className="text-muted-foreground">median</span>{" "}
                    {pct(cmp.data.headline_a.median_abs_rel_error)} →{" "}
                    {pct(cmp.data.headline_b.median_abs_rel_error)}{" "}
                    <DeltaBadge
                      value={
                        cmp.data.headline_b.median_abs_rel_error != null &&
                        cmp.data.headline_a.median_abs_rel_error != null
                          ? cmp.data.headline_b.median_abs_rel_error -
                            cmp.data.headline_a.median_abs_rel_error
                          : null
                      }
                    />
                  </span>
                  <span>
                    <span className="text-muted-foreground">mean</span>{" "}
                    {pct(cmp.data.headline_a.mean_abs_rel_error)} →{" "}
                    {pct(cmp.data.headline_b.mean_abs_rel_error)}{" "}
                    <DeltaBadge
                      value={
                        cmp.data.headline_b.mean_abs_rel_error != null &&
                        cmp.data.headline_a.mean_abs_rel_error != null
                          ? cmp.data.headline_b.mean_abs_rel_error -
                            cmp.data.headline_a.mean_abs_rel_error
                          : null
                      }
                    />
                  </span>
                  <span>
                    <span className="text-muted-foreground">within 5%</span>{" "}
                    {pct(cmp.data.headline_a.pct_within_5pct)} →{" "}
                    {pct(cmp.data.headline_b.pct_within_5pct)}{" "}
                    <DeltaBadge
                      value={
                        cmp.data.headline_b.pct_within_5pct != null &&
                        cmp.data.headline_a.pct_within_5pct != null
                          ? cmp.data.headline_b.pct_within_5pct -
                            cmp.data.headline_a.pct_within_5pct
                          : null
                      }
                      improveIsLower={false}
                    />
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
