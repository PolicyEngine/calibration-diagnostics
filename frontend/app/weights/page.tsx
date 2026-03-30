"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  MetricCard,
  DataTable,
  SegmentedControl,
  PEBarChart,
  ChartContainer,
  Skeleton,
  Stack,
  Group,
  Title,
  formatNumber,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import {
  useWeightDistribution,
  useWeightHistogram,
} from "@/lib/api/hooks/use-weights";
import { useState } from "react";

const sliceColumns = [
  { key: "label", header: "Slice" },
  {
    key: "n",
    header: "N",
    align: "right" as const,
    format: (v: unknown) => Number(v).toLocaleString(),
  },
  {
    key: "kish_effective_n",
    header: "Kish Eff N",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "mean",
    header: "Mean",
    align: "right" as const,
    format: (v: unknown) => Number(v).toFixed(2),
  },
  {
    key: "median",
    header: "Median",
    align: "right" as const,
    format: (v: unknown) => Number(v).toFixed(2),
  },
];

export default function WeightsPage() {
  const [sliceBy, setSliceBy] = useState("none");
  const [metric, setMetric] = useState("g_weight");

  const distribution = useWeightDistribution({ sliceBy, metric });
  const histogram = useWeightHistogram({ metric, logScale: true });

  const histogramChartData =
    histogram.data?.map((bin) => ({
      range: `${bin.bin_min.toFixed(2)}-${bin.bin_max.toFixed(0)}`,
      count: bin.count,
    })) ?? [];

  return (
    <AppShell>
      <Stack gap="lg">
        <Title order={2}>Weight Landscape</Title>

        {/* Controls */}
        <Group gap="lg">
          <Stack gap="xs">
            <span className="text-sm text-muted-foreground">Metric</span>
            <SegmentedControl
              value={metric}
              onValueChange={setMetric}
              options={[
                { label: "G-Weight", value: "g_weight" },
                { label: "Final", value: "final_weight" },
                { label: "Initial", value: "initial_weight" },
              ]}
            />
          </Stack>
          <Stack gap="xs">
            <span className="text-sm text-muted-foreground">Slice By</span>
            <SegmentedControl
              value={sliceBy}
              onValueChange={setSliceBy}
              options={[
                { label: "None", value: "none" },
                { label: "Income Decile", value: "income_decile" },
                { label: "Poverty", value: "poverty_status" },
                { label: "State", value: "state" },
              ]}
            />
          </Stack>
        </Group>

        {/* Stats cards */}
        {distribution.data ? (
          <Group gap="md" wrap="wrap">
            <MetricCard
              label="Kish Effective N"
              value={distribution.data.kish_effective_n}
              format="number"
            />
            <MetricCard
              label="CV"
              value={distribution.data.cv}
              format="number"
            />
            <MetricCard
              label="Design Effect"
              value={distribution.data.design_effect}
              format="number"
            />
            <MetricCard
              label="Top 1% Share"
              value={distribution.data.top_1pct_weight_share / 100}
              format="percent"
              trend="negative"
            />
            <MetricCard
              label="Top 5% Share"
              value={distribution.data.top_5pct_weight_share / 100}
              format="percent"
              trend="negative"
            />
          </Group>
        ) : (
          <Group gap="md">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-40" />
            ))}
          </Group>
        )}

        {/* Histogram */}
        {histogram.data ? (
          <ChartContainer title="Weight Distribution (log scale)">
            <PEBarChart
              data={histogramChartData}
              xKey="range"
              yKey="count"
              height={300}
              fillColor="var(--chart-1)"
            />
          </ChartContainer>
        ) : (
          <Skeleton className="h-80 w-full" />
        )}

        {/* Slices */}
        {distribution.data && distribution.data.slices.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Weight Stats by Slice</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable columns={sliceColumns} data={distribution.data.slices} />
            </CardContent>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
