"use client";

import { useState, type ReactNode } from "react";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Stack,
  Text,
  Title,
  formatNumber,
} from "@policyengine/ui-kit";

import { AppShell } from "@/components/layout/app-shell";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import {
  type MicroplexBudgetBenchmarkRow,
  useMicroplexBudgetBenchmarks,
} from "@/lib/api/hooks/use-microplex";

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${formatNumber(abs)}`;
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function dateTime(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Date(value * 1000).toLocaleString();
}

function statusLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .replace("live model", "live model:")
    .replace("external score available", "external score available:");
}

function statusVariant(status: string): "success" | "secondary" {
  if (status.startsWith("live_model")) return "success";
  return "secondary";
}

function HelpText({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <span
      className="group relative inline-flex cursor-help items-center gap-1 underline decoration-dotted underline-offset-2"
      tabIndex={0}
    >
      {children}
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border text-[10px] leading-none text-muted-foreground no-underline">
        ?
      </span>
      <span className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 rounded-md border border-border bg-white p-3 text-left text-xs font-normal leading-snug text-foreground shadow-lg group-hover:block group-focus:block">
        {title}
      </span>
    </span>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: ReactNode;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-white p-3">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <div className="mt-1 text-xl font-semibold leading-tight">{value}</div>
      {detail ? (
        <Text size="xs" c="dimmed" className="mt-1">
          {detail}
        </Text>
      ) : null}
    </div>
  );
}

function primaryExternalEstimate(row: MicroplexBudgetBenchmarkRow) {
  return (
    row.external_estimates.find((estimate) => estimate.estimate != null) ??
    row.external_estimates[0] ??
    null
  );
}

function hasNumericExternalEstimate(row: MicroplexBudgetBenchmarkRow) {
  return row.external_estimates.some((estimate) => estimate.estimate != null);
}

function hasComparableExternalEstimate(row: MicroplexBudgetBenchmarkRow) {
  return row.external_estimates.some(
    (estimate) =>
      estimate.estimate != null &&
      estimate.comparable_to_live_annual_result === true,
  );
}

function sourceBadge(sourceType: string | undefined) {
  if (!sourceType) return null;
  const labels: Record<string, string> = {
    cbo_jct: "CBO/JCT",
    jct: "JCT",
    pwbm: "PWBM",
    official_score: "official",
    published_model_result: "model result",
    third_party_context: "third-party context",
    third_party_score: "third-party score",
  };
  return (
    <Badge variant="secondary">
      {labels[sourceType] ?? sourceType.replaceAll("_", " ")}
    </Badge>
  );
}

function ReformBenchmarkTable({
  rows,
}: {
  rows: MicroplexBudgetBenchmarkRow[];
}) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-white">
      <table className="w-full min-w-[1320px] text-sm">
        <thead>
          <tr className="border-b border-border bg-gray-50 text-xs text-muted-foreground">
            <th className="px-3 py-3 text-left font-semibold">
              <HelpText title="The policy reform and modeled outcome. Rows marked live have been run over both us-data and the configured Microplex H5.">
                Reform
              </HelpText>
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              <HelpText title="Budget effect from running the reform over the baseline us-data dataset. Positive means higher federal cost or lower revenue.">
                us-data
              </HelpText>
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              <HelpText title="Budget effect from running the same reform over the configured Microplex candidate H5.">
                Microplex
              </HelpText>
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              <HelpText title="Microplex budget effect divided by us-data budget effect. This is dataset sensitivity, not a calibration score.">
                Microplex / us-data
              </HelpText>
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              <HelpText title="Best available third-party or official benchmark for this row. Some entries are context only and have no numeric score.">
                External estimate
              </HelpText>
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              <HelpText title="us-data modeled budget effect minus the numeric external estimate, when directly available.">
                us-data gap
              </HelpText>
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              <HelpText title="Microplex modeled budget effect minus the numeric external estimate, when directly available.">
                Microplex gap
              </HelpText>
            </th>
            <th className="px-3 py-3 text-left font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const external = primaryExternalEstimate(row);
            const live = row.live;
            return (
              <tr
                key={row.id}
                className="border-b border-border last:border-b-0 hover:bg-gray-50"
              >
                <td className="px-3 py-3 align-top">
                  <div className="max-w-[320px]">
                    <div className="font-medium">{row.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.policy_area} - {row.benchmark_period}
                    </div>
                    {live.available ? (
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {live.outcome_variable}.{live.outcome_entity} -{" "}
                        {live.period}
                      </div>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-3 text-right align-top font-mono">
                  {money(live.us_data?.budget_effect)}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono">
                  {money(live.microplex?.budget_effect)}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono">
                  {pct(live.microplex_budget_effect_as_share_of_us_data)}
                </td>
                <td className="px-3 py-3 text-right align-top">
                  {external ? (
                    <div>
                      <a
                        href={external.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-primary hover:underline"
                      >
                        {money(external.estimate)}
                      </a>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {external.source} - {external.period}
                      </div>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono">
                  {money(external?.us_data_gap)}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono">
                  {money(external?.microplex_gap)}
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex max-w-[220px] flex-wrap gap-1">
                    <Badge variant={live.available ? "success" : "secondary"}>
                      {live.available ? "computed" : "not wired"}
                    </Badge>
                    <Badge variant={statusVariant(row.comparison_status)}>
                      {statusLabel(row.comparison_status)}
                    </Badge>
                    {sourceBadge(external?.source_type)}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExternalEstimateList({ row }: { row: MicroplexBudgetBenchmarkRow }) {
  return (
    <div className="space-y-2">
      {row.external_estimates.map((estimate) => (
        <div key={`${row.id}-${estimate.source}`} className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={estimate.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              {estimate.source}
            </a>
            {sourceBadge(estimate.source_type)}
            <span className="text-muted-foreground">{estimate.period}</span>
          </div>
          <Text size="sm" c="dimmed">
            {estimate.estimate_label}
          </Text>
        </div>
      ))}
    </div>
  );
}

function BenchmarkDetail({ row }: { row: MicroplexBudgetBenchmarkRow }) {
  const live = row.live;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{row.title}</CardTitle>
            <Text size="sm" c="dimmed" className="mt-1">
              {row.policy_area} - {row.benchmark_period}
            </Text>
          </div>
          <Badge variant={live.available ? "success" : "secondary"}>
            {live.available ? "computed" : "not wired"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div>
            <Text size="xs" c="dimmed" className="mb-1">
              Live model contract
            </Text>
            {live.available ? (
              <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
                <div>
                  Reform{" "}
                  <span className="font-mono">
                    {live.reform?.id ?? "unknown"}
                  </span>
                </div>
                <div>
                  Outcome{" "}
                  <span className="font-mono">
                    {live.outcome_variable}.{live.outcome_entity}
                  </span>
                </div>
                <div>
                  us-data records{" "}
                  {formatNumber(live.us_data?.baseline.record_count ?? 0)} -
                  Microplex records{" "}
                  {formatNumber(live.microplex?.baseline.record_count ?? 0)}
                </div>
                {live.reform?.source_url ? (
                  <a
                    href={live.reform.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    PolicyEngine reform source
                  </a>
                ) : null}
              </div>
            ) : (
              <Text size="sm" c="dimmed">
                {live.reason ?? "No live model is available for this row."}
              </Text>
            )}
          </div>
          <div>
            <Text size="xs" c="dimmed" className="mb-1">
              External estimates
            </Text>
            <ExternalEstimateList row={row} />
          </div>
        </div>
        <Text size="sm" c="dimmed" className="mt-4">
          {row.notes}
        </Text>
      </CardContent>
    </Card>
  );
}

export default function ReformBenchmarksPage() {
  const [computeLive, setComputeLive] = useState(false);
  const { data, isLoading, isFetching, error } =
    useMicroplexBudgetBenchmarks(computeLive);

  if (isLoading) {
    return (
      <AppShell>
        <LoadingBlock label="Loading cached reform benchmark results..." />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <Text size="sm" c="red">
          Failed to load reform benchmarks: {String(error)}
        </Text>
      </AppShell>
    );
  }

  if (!data) return null;

  const scoredRows = data.rows.filter(
    (row) => row.live.available && hasComparableExternalEstimate(row),
  );
  const modelOnlyRows = data.rows.filter(
    (row) => row.live.available && !hasNumericExternalEstimate(row),
  );
  const waterfallRows = data.rows.filter(
    (row) =>
      hasNumericExternalEstimate(row) && !hasComparableExternalEstimate(row),
  );
  const externalOnlyRows = data.rows.filter(
    (row) => !row.live.available && hasComparableExternalEstimate(row),
  );
  const otherRows = data.rows.filter(
    (row) => !row.live.available && !hasNumericExternalEstimate(row),
  );
  const detailRows = [
    ...scoredRows,
    ...waterfallRows,
    ...externalOnlyRows,
    ...modelOnlyRows,
    ...otherRows,
  ];

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Title order={2}>Reform benchmarks</Title>
              <Text c="dimmed" size="sm" className="max-w-5xl">
                Third-party and official benchmark catalog for clean,
                provision-level reform comparisons. Live us-data/Microplex
                microsims are deferred because full income_tax calculations
                are expensive on page load. {data.sign_convention}
              </Text>
            </div>
            <button
              type="button"
              onClick={() => setComputeLive(true)}
              disabled={computeLive || isFetching}
              className="rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {computeLive
                ? isFetching
                  ? "Computing..."
                  : "Live results loaded"
                : "Compute live results"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Metric
            label="Scored benchmark rows"
            value={formatNumber(scoredRows.length)}
            detail="live model + numeric external"
          />
          <Metric
            label="Model-only rows"
            value={formatNumber(modelOnlyRows.length)}
            detail="computed, no score"
          />
          <Metric
            label="External scores to wire"
            value={formatNumber(externalOnlyRows.length)}
            detail="clean score, no live reform"
          />
          <Metric
            label="Generated"
            value={dateTime(data.generated_at_unix)}
            detail={
              data.runtime_seconds == null
                ? undefined
                : `runtime ${data.runtime_seconds.toFixed(1)}s`
            }
          />
        </div>

        <Card>
          <CardContent className="py-4">
            <Text size="sm" c="dimmed">
              {data.comparison_caveat} Current live rows are annual aggregate
              outcome deltas, not full conventional budget scores unless the
              reform is narrow enough for that outcome to capture the score.
            </Text>
          </CardContent>
        </Card>

        {data.errors.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Run errors</CardTitle>
            </CardHeader>
            <CardContent>
              <Stack gap="xs">
                {data.errors.map((item) => (
                  <Text key={item.benchmark_id} size="sm" c="red">
                    {item.benchmark_id}: {item.error}
                  </Text>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ) : null}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Title order={3}>Scored reform benchmarks</Title>
            <Badge variant="success">
              {formatNumber(scoredRows.length)} comparable
            </Badge>
          </div>
          {scoredRows.length ? (
            <ReformBenchmarkTable rows={scoredRows} />
          ) : (
            <Card>
              <CardContent className="py-4">
                <Text size="sm" c="dimmed">
                  No reform currently has both a live us-data/Microplex run and
                  a numeric third-party estimate.
                </Text>
              </CardContent>
            </Card>
          )}
        </div>

        {externalOnlyRows.length ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Title order={3}>Scores awaiting live compute</Title>
              <Badge variant="secondary">
                {formatNumber(externalOnlyRows.length)} pending
              </Badge>
            </div>
            <ReformBenchmarkTable rows={externalOnlyRows} />
          </div>
        ) : null}

        {waterfallRows.length ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Title order={3}>Waterfall score context</Title>
              <Badge variant="secondary">
                {formatNumber(waterfallRows.length)} contextual
              </Badge>
            </div>
            <ReformBenchmarkTable rows={waterfallRows} />
          </div>
        ) : null}

        {modelOnlyRows.length ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Title order={3}>Model-only smoke tests</Title>
              <Badge variant="secondary">
                {formatNumber(modelOnlyRows.length)} unscored
              </Badge>
            </div>
            <ReformBenchmarkTable rows={modelOnlyRows} />
          </div>
        ) : null}

        {otherRows.length ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Title order={3}>Other rows</Title>
              <Badge variant="secondary">
                {formatNumber(otherRows.length)} rows
              </Badge>
            </div>
            <ReformBenchmarkTable rows={otherRows} />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4">
          {detailRows.map((row) => (
            <BenchmarkDetail key={row.id} row={row} />
          ))}
        </div>
      </Stack>
    </AppShell>
  );
}
