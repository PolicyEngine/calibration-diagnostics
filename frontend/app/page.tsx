"use client";

import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Skeleton,
  Stack,
  Title,
  Text,
  Badge,
  formatNumber,
  PEBarChart,
  ChartContainer,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import { useSummary, type SummaryResponse } from "@/lib/api/hooks/use-summary";
import { useRunContext } from "@/lib/run-context";

function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function num(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return formatNumber(v);
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-white">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <span className="text-2xl font-bold tracking-tight">{value}</span>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
}

function Scorecard({ data }: { data: SummaryResponse }) {
  const h = data.headline;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi
        label="Targets within ±5%"
        value={pct(h.pct_within_5pct)}
        hint={`${num(h.n_targets_included)} included targets`}
      />
      <Kpi
        label="Targets within ±10%"
        value={pct(h.pct_within_10pct)}
      />
      <Kpi
        label="Median absolute rel. error"
        value={pct(h.median_abs_rel_error, 2)}
        hint={`p95: ${pct(h.p95_abs_rel_error)}`}
      />
      <Kpi
        label="Total loss"
        value={num(h.total_loss)}
        hint={`${num(h.n_households)} households`}
      />
    </div>
  );
}

function ErrorDistribution({ data }: { data: SummaryResponse }) {
  const fmt = (v: number) => `${Math.round(v * 100)}%`;
  const bins = data.error_distribution.map((b) => ({
    range: b.overflow ? `>${fmt(b.bin_min)}` : `${fmt(b.bin_min)}–${fmt(b.bin_max)}`,
    count: b.count,
  }));
  if (bins.length === 0) {
    return <Text c="dimmed">No targets to plot.</Text>;
  }
  return (
    <PEBarChart
      data={bins}
      xKey="range"
      yKey="count"
      height={260}
      fillColor="var(--chart-1)"
    />
  );
}

function WorstTargets({ rows }: { rows: SummaryResponse["worst_targets"] }) {
  if (rows.length === 0) {
    return <Text c="dimmed">No targets to show.</Text>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
          <th className="py-2">Target</th>
          <th className="py-2 text-right">Target value</th>
          <th className="py-2 text-right">Estimate</th>
          <th className="py-2 text-right">Rel. error</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.target_idx} className="border-b border-border/40 hover:bg-muted/30">
            <td className="py-2 font-mono text-xs">
              <Link
                href={`/targets?target_idx=${r.target_idx}`}
                className="text-primary hover:underline"
              >
                {r.target_name}
              </Link>
            </td>
            <td className="py-2 text-right">{num(r.value)}</td>
            <td className="py-2 text-right">{num(r.estimate)}</td>
            <td className="py-2 text-right">
              <Badge variant={r.abs_rel_error > 0.25 ? "destructive" : "secondary"}>
                {r.rel_error >= 0 ? "+" : ""}
                {(r.rel_error * 100).toFixed(1)}%
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Page() {
  const { dataset, run } = useRunContext();
  const summary = useSummary();

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Run summary</Title>
          <Text c="dimmed" size="sm">
            {dataset && run ? (
              <>
                Dataset <strong>{dataset}</strong> · Run{" "}
                <strong>{run}</strong>
              </>
            ) : (
              "Select a dataset and run above to load diagnostics."
            )}
          </Text>
        </div>

        {summary.isLoading && (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </>
        )}

        {summary.error && (
          <Card>
            <CardContent className="py-6">
              <Text c="red">
                Failed to load summary: {String(summary.error)}
              </Text>
            </CardContent>
          </Card>
        )}

        {summary.data && (
          <>
            <Scorecard data={summary.data} />

            <Card>
              <CardHeader>
                <CardTitle>Absolute relative error distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer title="">
                  <ErrorDistribution data={summary.data} />
                </ChartContainer>
              </CardContent>
            </Card>


            <Card>
              <CardHeader>
                <CardTitle>Top 10 worst-fit targets</CardTitle>
              </CardHeader>
              <CardContent>
                <WorstTargets rows={summary.data.worst_targets} />
              </CardContent>
            </Card>

          </>
        )}
      </Stack>
    </AppShell>
  );
}
