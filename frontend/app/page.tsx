"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  DataTable,
  Skeleton,
  Stack,
  Group,
  Title,
  Text,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  formatNumber,
  PEBarChart,
  ChartContainer,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import {
  usePovertyRate,
  useMedianAgi,
  useCalibrationFit,
  type CalibrationFit,
} from "@/lib/api/hooks/use-statistics";
import { useTargets } from "@/lib/api/hooks/use-targets";
import { useGeo, useGeoParams } from "@/lib/geo-context";
import { getBenchmark, SOURCE_URLS } from "@/lib/census-benchmarks";
import { STATE_FIPS_TO_NAME } from "@/lib/geo-names";

// --- Helpers ---

function Tip({ label, tip }: { label: string; tip: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="underline decoration-dotted decoration-gray-400 cursor-help">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-sm">
          <p>{tip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ComparisonMetric({
  label,
  tooltip,
  value,
  benchmark,
  benchmarkLabel,
  sourceUrl,
  format = "number",
}: {
  label: string;
  tooltip: string;
  value: number | null;
  benchmark: number | null;
  benchmarkLabel: string;
  sourceUrl?: string;
  format?: "number" | "percent" | "currency";
}) {
  const fmt = (v: number) => {
    if (format === "percent") return `${v.toFixed(1)}%`;
    if (format === "currency") return `$${formatNumber(v)}`;
    return formatNumber(v);
  };

  const delta =
    value !== null && benchmark !== null
      ? ((value - benchmark) / benchmark) * 100
      : null;

  return (
    <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-white min-w-[200px]">
      <Text size="xs" c="dimmed">
        <Tip label={label} tip={tooltip} />
      </Text>
      {value !== null ? (
        <span className="text-2xl font-bold tracking-tight">{fmt(value)}</span>
      ) : (
        <Skeleton className="h-8 w-24" />
      )}
      {benchmark !== null && value !== null && (
        <div className="flex items-center gap-2 mt-1">
          <Text size="xs" c="dimmed">
            {benchmarkLabel}: {fmt(benchmark)}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 inline-block text-primary hover:text-primary/80"
                title="View source data"
              >
                ↗
              </a>
            )}
          </Text>
          {delta !== null && (
            <Badge
              variant={Math.abs(delta) < 10 ? "success" : Math.abs(delta) < 30 ? "warning" : "error"}
            >
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}%
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function FitScoreRing({ fit }: { fit: CalibrationFit }) {
  const score = fit.weighted_score;
  const pct = Math.round(score * 100);
  const color =
    score >= 0.7 ? "text-green-600" : score >= 0.4 ? "text-yellow-600" : "text-red-600";
  const bg =
    score >= 0.7 ? "stroke-green-500" : score >= 0.4 ? "stroke-yellow-500" : "stroke-red-500";

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
          <circle
            cx="18" cy="18" r="15.5"
            fill="none"
            stroke="currentColor"
            className="text-gray-100"
            strokeWidth="3"
          />
          <circle
            cx="18" cy="18" r="15.5"
            fill="none"
            className={bg}
            strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xl font-bold ${color}`}>{pct}%</span>
        </div>
      </div>
      <Text size="xs" c="dimmed">
        <Tip
          label="Weighted score"
          tip="Excellent targets score 1.0, good targets 0.5, needs work 0.0. This is the average across all targets at this geographic level."
        />
      </Text>
    </div>
  );
}

function FitBreakdownBar({ fit }: { fit: CalibrationFit }) {
  const total = fit.total_targets;
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex h-6 rounded-full overflow-hidden bg-gray-100">
        {fit.excellent > 0 && (
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${fit.excellent_pct}%` }}
          />
        )}
        {fit.good > 0 && (
          <div
            className="bg-yellow-400 transition-all"
            style={{ width: `${fit.good_pct}%` }}
          />
        )}
        {fit.needs_work > 0 && (
          <div
            className="bg-red-400 transition-all"
            style={{ width: `${fit.needs_work_pct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-xs">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          <Tip
            label={`Excellent: ${fit.excellent} (${fit.excellent_pct.toFixed(0)}%)`}
            tip="Targets with less than 5% absolute relative error. The calibrated estimate is very close to the target value."
          />
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          <Tip
            label={`Good: ${fit.good} (${fit.good_pct.toFixed(0)}%)`}
            tip="Targets with 5–20% absolute relative error. The estimate is reasonably close but has noticeable deviation."
          />
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
          <Tip
            label={`Needs work: ${fit.needs_work} (${fit.needs_work_pct.toFixed(0)}%)`}
            tip="Targets with more than 20% absolute relative error. The optimizer struggled significantly with these targets."
          />
        </span>
      </div>
    </div>
  );
}

const targetTableColumns = [
  {
    key: "target_id",
    header: "ID",
    format: (val: unknown) => val !== null ? `#${val}` : "",
  },
  {
    key: "geo_display_name",
    header: "Geography",
    format: (val: unknown) => String(val ?? "National"),
  },
  { key: "variable", header: "Variable" },
  {
    key: "target_value",
    header: "Target value",
    align: "right" as const,
    format: (val: unknown) => formatNumber(Number(val)),
  },
  {
    key: "constraints",
    header: "Constraints",
    format: (val: unknown) => {
      const arr = val as string[];
      if (!arr || arr.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <div className="flex flex-col gap-0.5">
          {arr.map((c: string, i: number) => (
            <span key={i} className="text-sm whitespace-nowrap">{c}</span>
          ))}
        </div>
      );
    },
  },
  {
    key: "estimate",
    header: "Estimate",
    align: "right" as const,
    format: (val: unknown) => formatNumber(Number(val)),
  },
  {
    key: "rel_error",
    header: "Rel. error",
    align: "right" as const,
    format: (val: unknown) => {
      const v = Number(val);
      const abs = Math.abs(v);
      const variant = abs > 0.5 ? "error" : abs > 0.2 ? "warning" : abs > 0.05 ? "secondary" : "success";
      const display = abs >= 1 ? `${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(1)}%`;
      return <Badge variant={variant}>{display}</Badge>;
    },
  },
  {
    key: "abs_error",
    header: "Abs. error",
    align: "right" as const,
    format: (val: unknown) => formatNumber(Number(val)),
  },
  {
    key: "loss_contribution",
    header: "Loss contribution",
    align: "right" as const,
    format: (val: unknown) => {
      const v = Number(val);
      if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
      if (v >= 0.001) return `${(v * 100).toFixed(2)}%`;
      return `${(v * 100).toFixed(3)}%`;
    },
  },
];

// --- Main Page ---

export default function OverviewNewPage() {
  const { geo } = useGeo();
  const geoParams = useGeoParams();

  const povertyRate = usePovertyRate(geoParams);
  const medianAgi = useMedianAgi(geoParams);
  const calibrationFit = useCalibrationFit({
    geoLevel: geo.level,
    stateFips: geo.stateFips,
    includedOnly: true,
  });
  const worstTargets = useTargets({
    sortBy: "abs_rel_error",
    sortOrder: "desc",
    geoLevel: geo.level,
    stateFips: geo.stateFips,
    includedOnly: true,
    limit: 10,
  });
  const bestTargets = useTargets({
    sortBy: "abs_rel_error",
    sortOrder: "asc",
    geoLevel: geo.level,
    stateFips: geo.stateFips,
    includedOnly: true,
    limit: 10,
  });

  // Resolve geography label
  const geoLabel =
    geo.level === "national"
      ? "US"
      : geo.label || (geo.stateFips ? STATE_FIPS_TO_NAME[geo.stateFips] : "");

  // Census benchmark for this geography
  const benchmarkKey =
    geo.level === "national"
      ? "United States"
      : geo.stateFips
        ? STATE_FIPS_TO_NAME[geo.stateFips] ?? ""
        : "";
  const benchmark = getBenchmark(benchmarkKey);

  return (
    <AppShell>
      <TooltipProvider>
        <Stack gap="lg">
          {/* Header */}
          <Title order={2}>{geoLabel}: Overview</Title>

          {/* Population & key metrics */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Tip
                  label="Population & key metrics"
                  tip="Top-line statistics for this geography, compared against Census benchmarks where available."
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <ComparisonMetric
                  label="Total individuals"
                  tooltip="Weighted individual count from the calibrated dataset. Each household's weight is multiplied by its household size."
                  value={povertyRate.data?.n_total_weighted_individuals ?? null}
                  benchmark={benchmark?.population_2020 ?? null}
                  benchmarkLabel="2020 Census"
                  sourceUrl={SOURCE_URLS.census_2020}
                  format="number"
                />
                <ComparisonMetric
                  label="Total households"
                  tooltip="Sum of all household weights in the calibrated dataset."
                  value={povertyRate.data?.n_total_weighted_households ?? null}
                  benchmark={benchmark?.households_2020 ?? null}
                  benchmarkLabel="2020 Census"
                  sourceUrl={SOURCE_URLS.census_2020}
                  format="number"
                />
                <ComparisonMetric
                  label="SPM poverty rate"
                  tooltip="Supplemental Poverty Measure rate: the weighted fraction of households where SPM unit net income falls below the SPM threshold."
                  value={
                    povertyRate.data
                      ? povertyRate.data.spm_poverty_rate * 100
                      : null
                  }
                  benchmark={benchmark?.spm_rate ?? null}
                  benchmarkLabel="Census (2022–2024 avg)"
                  sourceUrl={SOURCE_URLS.spm_opm}
                  format="percent"
                />
                <ComparisonMetric
                  label="Median household AGI"
                  tooltip="Weighted median adjusted gross income across all households in this geography. Benchmark from FRED/Census SAIPE (2023)."
                  value={medianAgi.data?.median_agi ?? null}
                  benchmark={benchmark?.median_agi ?? null}
                  benchmarkLabel="FRED/Census (2023)"
                  sourceUrl={
                    benchmark?.median_agi_fred_series
                      ? `https://fred.stlouisfed.org/series/${benchmark.median_agi_fred_series}`
                      : undefined
                  }
                  format="currency"
                />
              </div>
            </CardContent>
          </Card>

          {/* Calibration fit */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Tip
                  label="Calibration fit"
                  tip="How well the calibrated weights match the target values for this geographic level. Targets are classified by absolute relative error: excellent (<5%), good (5–20%), needs work (>20%)."
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {calibrationFit.data ? (
                <div className="flex flex-col lg:flex-row gap-8 items-start">
                  {/* Score ring + total */}
                  <div className="flex flex-col items-center gap-4">
                    <FitScoreRing fit={calibrationFit.data} />
                    <div className="text-center">
                      <span className="text-3xl font-bold">
                        {calibrationFit.data.total_targets.toLocaleString()}
                      </span>
                      <Text size="xs" c="dimmed">
                        <Tip
                          label="total targets"
                          tip="Number of calibration targets at this geographic level. Each target is a benchmark value (from IRS, Census, etc.) that the optimizer tries to match."
                        />
                      </Text>
                    </div>
                  </div>

                  {/* Breakdown + metrics */}
                  <div className="flex-1 flex flex-col gap-6 w-full">
                    <FitBreakdownBar fit={calibrationFit.data} />

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-white">
                        <Text size="xs" c="dimmed">
                          <Tip
                            label="Average relative error"
                            tip="Mean absolute relative error across all targets at this geographic level. Lower is better. Target: below 5% (0.05)."
                          />
                        </Text>
                        <span className="text-2xl font-bold">
                          {(calibrationFit.data.avg_rel_error * 100).toFixed(1)}%
                        </span>
                        <Badge
                          variant={
                            calibrationFit.data.avg_rel_error < 0.05
                              ? "success"
                              : calibrationFit.data.avg_rel_error < 0.20
                                ? "warning"
                                : "error"
                          }
                        >
                          {calibrationFit.data.avg_rel_error < 0.05
                            ? "On target (<5%)"
                            : calibrationFit.data.avg_rel_error < 0.20
                              ? "Elevated (5–20%)"
                              : `High (target: <5%)`}
                        </Badge>
                      </div>

                      <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-white">
                        <Text size="xs" c="dimmed">
                          <Tip
                            label="Excellent targets"
                            tip="Targets with less than 5% absolute relative error. The calibrated estimate is very close to the target value."
                          />
                        </Text>
                        <span className="text-2xl font-bold text-green-600">
                          {calibrationFit.data.excellent.toLocaleString()}
                        </span>
                        <Text size="xs" c="dimmed">
                          {calibrationFit.data.excellent_pct.toFixed(0)}% of targets
                        </Text>
                      </div>

                      <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-white">
                        <Text size="xs" c="dimmed">
                          <Tip
                            label="Good targets"
                            tip="Targets with 5–20% absolute relative error. The estimate is reasonably close but has noticeable deviation."
                          />
                        </Text>
                        <span className="text-2xl font-bold text-yellow-600">
                          {calibrationFit.data.good.toLocaleString()}
                        </span>
                        <Text size="xs" c="dimmed">
                          {calibrationFit.data.good_pct.toFixed(0)}% of targets
                        </Text>
                      </div>

                      <div className="flex flex-col gap-1 p-4 rounded-lg border border-border bg-white">
                        <Text size="xs" c="dimmed">
                          <Tip
                            label="Needs work"
                            tip="Targets with more than 20% absolute relative error. These are the targets to investigate first."
                          />
                        </Text>
                        <span className="text-2xl font-bold text-red-500">
                          {calibrationFit.data.needs_work.toLocaleString()}
                        </span>
                        <Text size="xs" c="dimmed">
                          {calibrationFit.data.needs_work_pct.toFixed(0)}% of targets
                        </Text>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </CardContent>
          </Card>
          {/* Worst 10 targets */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Tip
                  label="Worst-fit targets"
                  tip="The 10 targets with the highest absolute relative error at this geographic level. These are the targets the calibration struggled most with."
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {worstTargets.data ? (
                <div className="overflow-x-auto">
                  <DataTable
                    columns={targetTableColumns}
                    data={worstTargets.data.items}
                  />
                </div>
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </CardContent>
          </Card>

          {/* Best 10 targets */}
          <Card>
            <CardHeader>
              <CardTitle>
                <Tip
                  label="Best-fit targets"
                  tip="The 10 targets with the lowest absolute relative error at this geographic level. These are the targets the calibration matched most closely."
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bestTargets.data ? (
                <div className="overflow-x-auto">
                  <DataTable
                    columns={targetTableColumns}
                    data={bestTargets.data.items}
                  />
                </div>
              ) : (
                <Skeleton className="h-48 w-full" />
              )}
            </CardContent>
          </Card>
        </Stack>
      </TooltipProvider>
    </AppShell>
  );
}
