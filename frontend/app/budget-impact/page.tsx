"use client";

import type { ReactNode } from "react";

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
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${formatNumber(abs)}`;
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
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
            <Badge variant="secondary">{estimate.source_type}</Badge>
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

function BenchmarkCard({ row }: { row: MicroplexBudgetBenchmarkRow }) {
  const live = row.live;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{row.title}</CardTitle>
            <Text size="sm" c="dimmed" className="mt-1">
              {row.policy_area} · {row.benchmark_period}
            </Text>
          </div>
          <Badge variant={statusVariant(row.comparison_status)}>
            {statusLabel(row.comparison_status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="md">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <Metric
              label={
                <HelpText title="Modeled budget effect is the live us-data aggregate reform delta using this row's outcome variable. Positive means higher federal cost.">
                  us-data budget effect
                </HelpText>
              }
              value={money(live.us_data?.budget_effect)}
              detail={
                live.available && live.outcome_variable
                  ? `${live.outcome_variable}, ${live.period}`
                  : live.reason ?? "not wired"
              }
            />
            <Metric
              label={
                <HelpText title="Same reform and outcome, run over the configured Microplex policyengine_us.h5 candidate dataset.">
                  Microplex budget effect
                </HelpText>
              }
              value={money(live.microplex?.budget_effect)}
              detail={
                live.microplex?.baseline.weight_sum != null
                  ? `weight sum ${formatNumber(live.microplex.baseline.weight_sum)}`
                  : live.reason ?? "not wired"
              }
            />
            <Metric
              label={
                <HelpText title="Microplex budget effect divided by us-data budget effect. This is dataset sensitivity, not a target loss metric.">
                  Microplex / us-data
                </HelpText>
              }
              value={pct(live.microplex_budget_effect_as_share_of_us_data)}
              detail={`gap ${money(live.budget_effect_gap)}`}
            />
            <Metric
              label={
                <HelpText title="The first external estimate linked for this row. Some rows have official decade scores but no matching live reform preset yet.">
                  External benchmark
                </HelpText>
              }
              value={money(row.external_estimates[0]?.estimate)}
              detail={row.external_estimates[0]?.estimate_label ?? "—"}
            />
          </div>

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
                    {formatNumber(live.us_data?.baseline.record_count ?? 0)} ·
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

          <Text size="sm" c="dimmed">
            {row.notes}
          </Text>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function BudgetImpactPage() {
  const { data, isLoading, error } = useMicroplexBudgetBenchmarks();

  if (isLoading) {
    return (
      <AppShell>
        <LoadingBlock label="Running budget benchmark comparisons…" />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <Text size="sm" c="red">
          Failed to load budget benchmarks: {String(error)}
        </Text>
      </AppShell>
    );
  }

  if (!data) return null;

  const liveRows = data.rows.filter((row) => row.live.available).length;
  const externalScoreRows = data.rows.filter((row) =>
    row.external_estimates.some((estimate) => estimate.estimate != null),
  ).length;

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Budget impact benchmarks</Title>
          <Text c="dimmed" size="sm" className="max-w-5xl">
            Live us-data and Microplex reform impacts, with CBO/JCT or other
            external estimates attached where the policy match is known.{" "}
            {data.sign_convention}
          </Text>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Metric label="Live rows" value={formatNumber(liveRows)} />
          <Metric
            label="Rows with numeric external score"
            value={formatNumber(externalScoreRows)}
          />
          <Metric
            label="Microplex bundle"
            value={data.microplex_bundle.available ? "loaded" : "missing"}
            detail={data.microplex_bundle.artifact_id ?? "no configured H5"}
          />
          <Metric
            label="Runtime"
            value={
              data.runtime_seconds == null
                ? "—"
                : `${data.runtime_seconds.toFixed(1)}s`
            }
          />
        </div>

        <Card>
          <CardContent className="py-4">
            <Text size="sm" c="dimmed">
              {data.comparison_caveat} Current live rows are budget proxies for
              the listed outcome, not full conventional budget scores unless
              the reform is narrow enough for that outcome to capture the score.
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

        {data.rows.map((row) => (
          <BenchmarkCard key={row.id} row={row} />
        ))}
      </Stack>
    </AppShell>
  );
}
