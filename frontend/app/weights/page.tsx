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
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  formatNumber,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import {
  useWeightDistribution,
  useWeightHistogram,
} from "@/lib/api/hooks/use-weights";
import { useGeo, useGeoParams } from "@/lib/geo-context";
import { useState } from "react";

function TipHeader({ label, tip }: { label: string; tip: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="underline decoration-dotted cursor-help">{label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{tip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function colorByDeviation(val: number, baseline: number): string {
  const ratio = Math.abs(val - baseline) / Math.max(baseline, 0.001);
  if (ratio > 2) return "bg-red-100 text-red-900";
  if (ratio > 1) return "bg-orange-100 text-orange-900";
  if (ratio > 0.5) return "bg-yellow-50 text-yellow-900";
  return "";
}

export default function WeightsPage() {
  const [sliceBy, setSliceBy] = useState("income_decile");
  const [metric, setMetric] = useState("g_weight");

  const { geo } = useGeo();
  const geoParams = useGeoParams();
  const distribution = useWeightDistribution({ sliceBy, metric, ...geoParams });
  const decileWeights = useWeightDistribution({
    sliceBy: "income_decile",
    metric: "final_weight",
    ...geoParams,
  });
  const histogram = useWeightHistogram({ metric, logScale: true, ...geoParams });

  const histogramChartData =
    histogram.data?.map((bin) => ({
      range: `${bin.bin_min.toFixed(2)}-${bin.bin_max.toFixed(0)}`,
      count: bin.count,
    })) ?? [];

  return (
    <AppShell>
      <Stack gap="lg">
        <Title order={2}>Weight landscape</Title>

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
            <span className="text-sm text-muted-foreground">Slice by</span>
            <SegmentedControl
              value={sliceBy}
              onValueChange={setSliceBy}
              options={[
                { label: "None", value: "none" },
                { label: "Income decile", value: "income_decile" },
                { label: "Poverty status", value: "poverty_status" },
                { label: "State", value: "state" },
              ]}
            />
          </Stack>
        </Group>

        {/* Stats cards */}
        {distribution.data ? (
          <TooltipProvider>
            <Group gap="md" wrap="wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <MetricCard
                      label="Effective sample size"
                      value={distribution.data.kish_effective_n}
                      format="number"
                      delta={`of ${formatNumber(5159570)} total records`}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Kish effective N: how many equally-weighted records this dataset is equivalent to. Lower means more information lost to unequal weighting.</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <MetricCard
                      label="Weight dispersion (CV)"
                      value={distribution.data.cv}
                      format="number"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Coefficient of variation of weights (std / mean). CV = 0 means all weights equal. Higher means more extreme weight variation. Values above 1 indicate significant distortion.</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <MetricCard
                      label="Design effect"
                      value={distribution.data.design_effect}
                      format="number"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Equal to 1 + CV². Measures how much unequal weighting inflates variance. A design effect of 5 means you'd need 5x fewer equally-weighted records for the same precision.</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <MetricCard
                      label="Weight held by top 1% of records"
                      value={distribution.data.top_1pct_weight_share / 100}
                      format="percent"
                      trend="negative"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Share of total population weight held by the heaviest 1% of records. High values mean a few records dominate all weighted statistics.</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <MetricCard
                      label="Weight held by top 5% of records"
                      value={distribution.data.top_5pct_weight_share / 100}
                      format="percent"
                      trend="negative"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Share of total population weight held by the heaviest 5% of records. In a healthy calibration this should be under 20%.</p>
                </TooltipContent>
              </Tooltip>
            </Group>
          </TooltipProvider>
        ) : (
          <Group gap="md">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-40" />
            ))}
          </Group>
        )}

        {/* Histogram */}
        {histogram.data ? (
          <ChartContainer title="Weight distribution (log scale)">
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

        {/* Weighted population by income decile */}
        {decileWeights.data && decileWeights.data.slices.length > 0 && (
          <ChartContainer
            title="Weighted population by income decile"
            subtitle="Weighted household count in each income decile — shows how calibration distributes household population across income levels"
          >
            <PEBarChart
              data={decileWeights.data.slices.map((s) => ({
                decile: s.label,
                weighted_population: Math.round(s.n * s.mean),
              }))}
              xKey="decile"
              yKey="weighted_population"
              height={300}
              fillColor="var(--chart-2)"
            />
          </ChartContainer>
        )}

        {/* Slices */}
        {distribution.data && distribution.data.slices.length > 0 && (() => {
          const slices = distribution.data!.slices;
          const overallMean = distribution.data!.mean;
          const overallMedian = distribution.data!.median;

          const metricLabel = metric === "g_weight" ? "g-weight" : metric.replace("_", " ");
          const sliceColumns = [
            {
              key: "label",
              header: "Group",
            },
            {
              key: "n",
              header: <TipHeader label="Records" tip="Number of clone-level records in this group. Each base household has 430 clones assigned to different geographies." />,
              align: "right" as const,
              format: (v: unknown) => Number(v).toLocaleString(),
            },
            {
              key: "weighted_pop",
              header: <TipHeader label="Weighted households" tip="Total household weight for this group (records × mean weight). Represents how many households this group accounts for in the weighted population." />,
              align: "right" as const,
              format: (v: unknown) => formatNumber(Number(v)),
            },
            {
              key: "kish_effective_n",
              header: <TipHeader label="Effective sample size" tip="Kish effective N for this group. How many equally-weighted records this group's records are equivalent to." />,
              align: "right" as const,
              format: (v: unknown) => formatNumber(Number(v)),
            },
            {
              key: "efficiency",
              header: <TipHeader label="Weighting efficiency" tip="Effective sample size / records. Shows what fraction of records carry useful information after weighting. Below 10% (red) means extreme weight concentration; below 25% (orange) is concerning." />,
              align: "right" as const,
              format: (v: unknown) => {
                const eff = Number(v);
                const cls = eff < 0.1 ? "bg-red-100 text-red-900 px-2 py-0.5 rounded" :
                            eff < 0.25 ? "bg-orange-100 text-orange-900 px-2 py-0.5 rounded" :
                            eff < 0.5 ? "bg-yellow-50 text-yellow-900 px-2 py-0.5 rounded" : "";
                return <span className={cls}>{(eff * 100).toFixed(1)}%</span>;
              },
            },
            {
              key: "mean",
              header: <TipHeader label={`Mean ${metricLabel}`} tip={`Average ${metricLabel} across all records in this group. Highlighted when it deviates significantly from the overall mean — red (>2x off), orange (>1x), yellow (>0.5x).`} />,
              align: "right" as const,
              format: (v: unknown) => {
                const val = Number(v);
                const cls = colorByDeviation(val, overallMean);
                return <span className={cls ? `${cls} px-2 py-0.5 rounded` : ""}>{val.toFixed(3)}</span>;
              },
            },
            {
              key: "median",
              header: <TipHeader label={`Median ${metricLabel}`} tip={`Median ${metricLabel} for records in this group. Highlighted when it deviates from the overall median.`} />,
              align: "right" as const,
              format: (v: unknown) => {
                const val = Number(v);
                const cls = colorByDeviation(val, overallMedian);
                return <span className={cls ? `${cls} px-2 py-0.5 rounded` : ""}>{val.toFixed(3)}</span>;
              },
            },
          ];

          const enrichedSlices = slices.map((s) => ({
            ...s,
            weighted_pop: Math.round(s.n * s.mean),
            efficiency: s.n > 0 ? s.kish_effective_n / s.n : 0,
          }));

          return (
            <Card>
              <CardHeader>
                <CardTitle>Weight analysis by group</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <DataTable columns={sliceColumns} data={enrichedSlices} />
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </Stack>
    </AppShell>
  );
}
