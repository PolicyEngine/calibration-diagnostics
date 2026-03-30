"use client";

import {
  MetricCard,
  DataTable,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Skeleton,
  Stack,
  Group,
  Title,
  Text,
  formatNumber,
  formatPercent,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import { useWeightDistribution } from "@/lib/api/hooks/use-weights";
import { useIncomeDistribution } from "@/lib/api/hooks/use-statistics";
import { useTargets } from "@/lib/api/hooks/use-targets";
import Link from "next/link";

const incomeColumns = [
  { key: "quantile", header: "Quantile" },
  { key: "initial", header: "Initial Weights", align: "right" as const },
  { key: "final", header: "Final Weights", align: "right" as const },
  { key: "delta", header: "Delta", align: "right" as const },
];

const targetColumns = [
  {
    key: "target_name",
    header: "Target",
    format: (val: unknown, row: Record<string, unknown>) => (
      <Link
        href={`/targets?selected=${row.target_idx}`}
        className="text-primary hover:underline text-sm"
      >
        {String(val)}
      </Link>
    ),
  },
  { key: "variable", header: "Variable" },
  { key: "geo_level", header: "Geo" },
  {
    key: "rel_error",
    header: "Rel Error",
    align: "right" as const,
    format: (val: unknown) => {
      const v = Number(val);
      const variant = Math.abs(v) > 0.5 ? "error" : Math.abs(v) > 0.2 ? "warning" : "success";
      return <Badge variant={variant}>{formatPercent(v, 1)}</Badge>;
    },
  },
  {
    key: "n_contributors",
    header: "Contributors",
    align: "right" as const,
    format: (val: unknown) => formatNumber(Number(val)),
  },
];

export default function OverviewPage() {
  const weights = useWeightDistribution();
  const income = useIncomeDistribution();
  const targets = useTargets({
    sortBy: "abs_rel_error",
    sortOrder: "desc",
    limit: 10,
  });

  const incomeData =
    income.data
      ? (["p5", "p10", "p25", "p50", "p75", "p90", "p95"] as const).map(
          (q) => ({
            quantile: q.toUpperCase(),
            initial: `$${formatNumber(income.data!.initial_weights[q])}`,
            final: `$${formatNumber(income.data!.final_weights[q])}`,
            delta: `$${formatNumber(income.data!.final_weights[q] - income.data!.initial_weights[q])}`,
          }),
        )
      : [];

  return (
    <AppShell>
      <Stack gap="lg">
        <Title order={2}>Calibration Overview</Title>

        {/* Weight distribution stats */}
        {weights.data ? (
          <Group gap="md" wrap="wrap">
            <MetricCard
              label="Kish Effective N"
              value={weights.data.kish_effective_n}
              format="number"
              delta={`Design effect: ${weights.data.design_effect.toFixed(1)}`}
            />
            <MetricCard
              label="CV of Weights"
              value={weights.data.cv}
              format="number"
            />
            <MetricCard
              label="Top 1% Weight Share"
              value={weights.data.top_1pct_weight_share / 100}
              format="percent"
              trend="negative"
            />
            <MetricCard
              label="Top 5% Weight Share"
              value={weights.data.top_5pct_weight_share / 100}
              format="percent"
              trend="negative"
            />
          </Group>
        ) : (
          <Group gap="md">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-48" />
            ))}
          </Group>
        )}

        {/* Income distribution comparison */}
        {income.data && (
          <Card>
            <CardHeader>
              <CardTitle>Income Distribution: Initial vs Final Weights</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable columns={incomeColumns} data={incomeData} />
            </CardContent>
          </Card>
        )}

        {/* Worst-fit targets */}
        <Card>
          <CardHeader>
            <CardTitle>Worst-Fit Targets (by absolute relative error)</CardTitle>
          </CardHeader>
          <CardContent>
            {targets.data ? (
              <DataTable columns={targetColumns} data={targets.data.items} />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}
