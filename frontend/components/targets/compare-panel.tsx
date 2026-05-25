"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  formatNumber,
} from "@policyengine/ui-kit";
import { useState } from "react";

import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { DataTable } from "@/components/shared/InteractiveDataTable";
import { useRuns } from "@/lib/api/hooks/use-runs";
import {
  useCompare,
  type CompareMover,
  type CompareHeadline,
  type CompareVariableRollup,
} from "@/lib/api/hooks/use-compare";
import { useRunContext } from "@/lib/run-context";

function pct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number | null | undefined, kind: "pct" | "frac" = "pct") {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  const txt = kind === "pct" ? `${(v * 100).toFixed(1)}%` : v.toFixed(3);
  return `${sign}${txt}`;
}

/** Lower is better (closer to target). Red on regress, green on improve. */
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
  return <Badge variant={variant}>{fmtDelta(value)}</Badge>;
}

function HeadlineCol({
  label,
  head,
}: {
  label: string;
  head: CompareHeadline;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>median <strong>{pct(head.median_abs_rel_error)}</strong></div>
      <div>mean <strong>{pct(head.mean_abs_rel_error)}</strong></div>
      <div>p95 <strong>{pct(head.p95_abs_rel_error)}</strong></div>
      <div>within 5% <strong>{pct(head.pct_within_5pct)}</strong></div>
      <div>within 25% <strong>{pct(head.pct_within_25pct)}</strong></div>
    </div>
  );
}

function HeadlineDeltas({
  a,
  b,
}: {
  a: CompareHeadline;
  b: CompareHeadline;
}) {
  const diff = (
    av: number | null | undefined,
    bv: number | null | undefined,
  ): number | null => {
    if (av == null || bv == null) return null;
    return bv - av;
  };
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Δ (B − A)
      </div>
      <div>median <DeltaBadge value={diff(a.median_abs_rel_error, b.median_abs_rel_error)} /></div>
      <div>mean <DeltaBadge value={diff(a.mean_abs_rel_error, b.mean_abs_rel_error)} /></div>
      <div>p95 <DeltaBadge value={diff(a.p95_abs_rel_error, b.p95_abs_rel_error)} /></div>
      <div>
        within 5%{" "}
        <DeltaBadge
          value={diff(a.pct_within_5pct, b.pct_within_5pct)}
          improveIsLower={false}
        />
      </div>
      <div>
        within 25%{" "}
        <DeltaBadge
          value={diff(a.pct_within_25pct, b.pct_within_25pct)}
          improveIsLower={false}
        />
      </div>
    </div>
  );
}

const moverColumns = [
  { key: "variable", header: "Variable" },
  {
    key: "geo",
    header: "Geo",
    format: (_: unknown, row: Record<string, unknown>) => {
      const lvl = String(row.geo_level);
      const gid = row.geographic_id;
      return gid ? `${lvl}/${gid}` : lvl;
    },
  },
  {
    key: "value",
    header: "Target",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "estimate_a",
    header: "Est A",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "estimate_b",
    header: "Est B",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "abs_rel_error_a",
    header: "|err| A",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`,
  },
  {
    key: "abs_rel_error_b",
    header: "|err| B",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`,
  },
  {
    key: "delta",
    header: "Δ",
    align: "right" as const,
    format: (v: unknown) => <DeltaBadge value={Number(v)} />,
  },
];

const variableColumns = [
  { key: "variable", header: "Variable" },
  {
    key: "n_targets",
    header: "n",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "mean_abs_rel_error_a",
    header: "mean A",
    align: "right" as const,
    format: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%`,
  },
  {
    key: "mean_abs_rel_error_b",
    header: "mean B",
    align: "right" as const,
    format: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%`,
  },
  {
    key: "mean_delta",
    header: "Δ mean",
    align: "right" as const,
    format: (v: unknown) => <DeltaBadge value={Number(v)} />,
  },
  {
    key: "n_improved",
    header: "Improved",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "n_regressed",
    header: "Regressed",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
];

interface CompareModeProps {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}

export function CompareModeToggle({ enabled, onToggle }: CompareModeProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Compare
      </span>
      <button
        onClick={() => onToggle(!enabled)}
        className={`h-8 px-3 rounded-md border text-sm transition-colors ${
          enabled
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background hover:bg-muted"
        }`}
      >
        {enabled ? "On" : "Off"}
      </button>
    </div>
  );
}

interface ComparePanelProps {
  runB: string | null;
  setRunB: (v: string | null) => void;
}

export function ComparePanel({ runB, setRunB }: ComparePanelProps) {
  const { dataset, run } = useRunContext();
  const runsQ = useRuns(dataset);
  const [topN, setTopN] = useState(25);
  const cmp = useCompare({
    dataset,
    runA: run,
    runB,
    topN,
    enabled: !!runB && runB !== run,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare runs</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack gap="md">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Run A (baseline)
              </span>
              <span className="font-mono text-xs">{run ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Run B
              </span>
              <Select
                value={runB ?? undefined}
                onValueChange={(v) => setRunB(v)}
                disabled={!dataset}
              >
                <SelectTrigger className="h-9 min-w-[320px]">
                  <SelectValue
                    placeholder={
                      runsQ.isLoading
                        ? "Loading…"
                        : runsQ.data?.length === 0
                          ? "No runs"
                          : "Pick a run to compare"
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
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Top N
              </span>
              <select
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!runB || runB === run ? (
            <Text size="sm" c="dimmed">
              Pick a second run to compare against the current run.
            </Text>
          ) : cmp.isLoading ? (
            <LoadingBlock
              label={`Loading run ${runB}… (first load can take ~2 min)`}
            />
          ) : cmp.error ? (
            <Text size="sm" c="red">
              Comparison failed: {String(cmp.error)}
            </Text>
          ) : cmp.data ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-y border-border py-3">
                <HeadlineCol label="A (baseline)" head={cmp.data.headline_a} />
                <HeadlineCol label="B" head={cmp.data.headline_b} />
                <HeadlineDeltas
                  a={cmp.data.headline_a}
                  b={cmp.data.headline_b}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Biggest improvements
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={moverColumns}
                      data={cmp.data.movers.improved as never}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Biggest regressions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={moverColumns}
                      data={cmp.data.movers.regressed as never}
                    />
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">By variable</CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={variableColumns}
                    data={cmp.data.by_variable as never}
                  />
                </CardContent>
              </Card>
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
