"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import {
  CrossDatasetFactDetailView,
  CrossDatasetFactsView,
} from "@/components/populace/cross-dataset-facts-view";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { apiGet } from "@/lib/api/client";
import type {
  CrossDatasetGroupsDocument,
  CrossDatasetSummary,
} from "@/lib/cross-dataset/artifact";
import {
  CROSS_DATASET_PAGE_TITLE,
  GROUP_DIMENSIONS,
  buildGroupRows,
  buildSourceOverviews,
  crossDatasetUiState,
  type GroupDimension,
  type LabeledCount,
} from "@/lib/cross-dataset/presentation";

interface OverviewResponse {
  summary: CrossDatasetSummary;
  groups: CrossDatasetGroupsDocument;
}

function useCrossDatasetOverview() {
  return useQuery({
    queryKey: ["cross-dataset", "overview", "v1"],
    queryFn: async (): Promise<OverviewResponse> => {
      const [summary, groups] = await Promise.all([
        apiGet<CrossDatasetSummary>("/populace/cross-dataset", { view: "summary" }),
        apiGet<CrossDatasetGroupsDocument>("/populace/cross-dataset", { view: "groups" }),
      ]);
      if (summary.run_id !== groups.run_id || summary.snapshot_id !== groups.snapshot_id) {
        throw new Error("Cross-dataset summary and group data belong to different runs.");
      }
      return { summary, groups };
    },
    staleTime: Infinity,
    retry: false,
  });
}

function formatPercent(value: number): string {
  if (value === 0) return "0%";
  if (value < 0.1) return value.toFixed(2) + "%";
  if (value < 10) return value.toFixed(1) + "%";
  return Math.round(value) + "%";
}

function PerformanceBar({
  value,
  label,
  tone = "performance",
}: {
  value: number | null;
  label: string;
  tone?: "performance" | "coverage";
}) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : Number(value.toFixed(2))}
      aria-valuetext={value == null ? "Not scored" : value.toFixed(1) + " percent"}
    >
      <div
        className={
          "h-full rounded-full " +
          (tone === "performance" ? "bg-primary" : "bg-[var(--info)]")
        }
        style={{ width: String(width) + "%" }}
      />
    </div>
  );
}

function CountList({ values, empty }: { values: LabeledCount[]; empty: string }) {
  if (!values.length) return <span className="text-xs text-muted-foreground">{empty}</span>;
  return (
    <ul className="space-y-1.5">
      {values.map((item) => (
        <li key={item.key} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-mono tabular-nums text-foreground">
            {item.count.toLocaleString("en-US")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CrossDatasetOverviewView() {
  const query = useCrossDatasetOverview();
  const [dimension, setDimension] = useState<GroupDimension>("ledger_source");
  const state = crossDatasetUiState({
    isLoading: query.isLoading,
    error: query.error,
    summary: query.data?.summary,
  });

  const sourceOverviews = useMemo(
    () =>
      query.data
        ? buildSourceOverviews(query.data.summary, query.data.groups.groups)
        : [],
    [query.data],
  );
  const groupRows = useMemo(
    () =>
      query.data
        ? buildGroupRows(query.data.groups.groups, dimension, query.data.summary.sources)
        : [],
    [dimension, query.data],
  );

  if (state === "loading") return <LoadingBlock label="Loading Cross-dataset results…" />;
  if (state === "error") {
    return (
      <EmptyState
        title="Cross-dataset results unavailable"
        description={
          query.error instanceof Error
            ? query.error.message
            : "The immutable evaluation artifact could not be loaded."
        }
        actions={
          <button
            type="button"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        }
      />
    );
  }
  if (state === "empty" || !query.data) {
    return (
      <EmptyState
        title="No Cross-dataset sources"
        description="The evaluation run is valid but does not contain any model or dataset results."
      />
    );
  }

  const { summary } = query.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace · cross-dataset"
        title={CROSS_DATASET_PAGE_TITLE}
        description={
          <>
            Every model is classified against the complete Ledger fact catalog. Performance
            measures closeness only among facts the source can evaluate; coverage shows how much
            of Ledger that score represents. Higher performance is better, but a high score with
            narrow coverage is not whole-Ledger accuracy.
          </>
        }
        status={
          <StatusPill tone={summary.matrix_complete ? "success" : "danger"}>
            {summary.matrix_complete ? "Complete capability matrix" : "Incomplete matrix"}
          </StatusPill>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--elev-1)]">
          <div className="font-mono text-xs text-muted-foreground">Ledger facts</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {summary.fact_count.toLocaleString("en-US")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Every fact has one cell per source.</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--elev-1)]">
          <div className="font-mono text-xs text-muted-foreground">Evaluation run</div>
          <div className="mt-2 truncate font-mono text-sm font-semibold" title={summary.run_id}>
            {summary.run_id}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Immutable result identity</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--elev-1)]">
          <div className="font-mono text-xs text-muted-foreground">Ledger snapshot</div>
          <div
            className="mt-2 truncate font-mono text-sm font-semibold"
            title={summary.snapshot_id}
          >
            {summary.snapshot_id}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Pinned source facts</p>
        </div>
      </div>

      <div className="rounded-lg border border-[color-mix(in_srgb,var(--info)_35%,var(--border))] bg-[color-mix(in_srgb,var(--info)_6%,var(--card))] px-4 py-3 text-sm">
        <p className="font-medium text-foreground">How to read the comparison</p>
        <p className="mt-1 text-muted-foreground">
          The performance score is 100 × (1 − family-balanced capped mean absolute percentage
          error ÷ 2). Populace results marked <strong>direct calibration target</strong> are
          in-sample calibration fit, not independent validation. Results marked{" "}
          <strong>2023 facts aligned to 2024</strong> compare against the 2024 transformation
          produced by the same aging and uprating logic used in the Populace build—not a native
          2023 society-wide run. Tax-Calculator’s public CPS rows use its population advanced to
          2024.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {sourceOverviews.map((source) => (
          <section
            key={source.sourceId}
            className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--elev-1)]"
          >
            <div className="border-b border-border bg-muted/20 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{source.label}</h2>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {source.sourceId}
                  </p>
                </div>
                <StatusPill tone={source.coveredCount ? "info" : "neutral"}>
                  {formatPercent(source.coveragePercent)} coverage
                </StatusPill>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs text-muted-foreground">Performance</span>
                    <span className="text-xl font-semibold tabular-nums">{source.scoreLabel}</span>
                  </div>
                  <div className="mt-2">
                    <PerformanceBar
                      value={source.performancePercent}
                      label={source.label + " performance"}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {source.scoreScopeLabel}
                  </p>
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs text-muted-foreground">Ledger coverage</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatPercent(source.coveragePercent)}
                    </span>
                  </div>
                  <div className="mt-3">
                    <PerformanceBar
                      value={source.coveragePercent}
                      label={source.label + " Ledger coverage"}
                      tone="coverage"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">{source.coverageLabel}</p>
                </div>
              </div>

              <div className="grid gap-5 border-t border-border pt-4 sm:grid-cols-3">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">
                    Coverage gaps
                  </h3>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {source.unsupportedCount.toLocaleString("en-US")} facts not evaluated
                  </p>
                  <CountList values={source.topUnsupportedReasons} empty="No recorded gaps" />
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">
                    Period handling
                  </h3>
                  <CountList values={source.periodTreatments} empty="No period categories" />
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground">
                    Benchmark relationship
                  </h3>
                  <CountList
                    values={source.calibrationExposures}
                    empty="No exposure categories"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-border bg-muted/10 px-5 py-2 text-[11px] text-muted-foreground">
              <span className="font-mono">Dataset:</span> {source.datasetVersion ?? "not recorded"}
              <span className="mx-2">·</span>
              <span className="font-mono">Model:</span> {source.modelVersion ?? "not applicable"}
            </div>
          </section>
        ))}
      </div>

      <SectionCard
        title="Performance by Ledger group"
        description="Each cell keeps its performance score beside the number of facts it can evaluate. Select a grouping to inspect where a model performs well, where it has sparse support, and why facts are unavailable."
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Group by
            <select
              value={dimension}
              onChange={(event) => setDimension(event.target.value as GroupDimension)}
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground"
              aria-label="Group Cross-dataset results"
            >
              {GROUP_DIMENSIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
        padded={false}
      >
        {groupRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">Group</th>
                  <th className="px-4 py-2.5 text-right">Ledger facts</th>
                  {summary.sources.map((source) => (
                    <th key={source.source_id} className="min-w-[220px] px-4 py-2.5">
                      {source.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => (
                  <tr key={row.key} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 align-top font-medium">{row.label}</td>
                    <td className="px-4 py-3 text-right align-top font-mono text-xs tabular-nums text-muted-foreground">
                      {row.factCount.toLocaleString("en-US")}
                    </td>
                    {summary.sources.map((source) => {
                      const cell = row.sources[source.source_id];
                      return (
                        <td key={source.source_id} className="px-4 py-3 align-top">
                          <Link
                            href={cell.factHref}
                            className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label={"View " + row.label + " facts for " + source.label}
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="font-semibold tabular-nums group-hover:text-primary">
                                {cell.scoreLabel}
                              </span>
                              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                {cell.coverageLabel}
                              </span>
                            </div>
                            <div className="mt-1.5">
                              <PerformanceBar
                                value={cell.performancePercent}
                                label={source.label + " performance for " + row.label}
                              />
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span>{formatPercent(cell.coveragePercent)} covered</span>
                              <span>
                                {cell.unsupportedCount
                                  ? cell.unsupportedCount.toLocaleString("en-US") + " unavailable"
                                  : "All represented"}
                              </span>
                            </div>
                            {cell.topUnsupportedReasons.length > 0 && (
                              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                {cell.topUnsupportedReasons
                                  .map(
                                    (reason) =>
                                      reason.label + ": " + reason.count.toLocaleString("en-US"),
                                  )
                                  .join(" · ")}
                              </p>
                            )}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              variant="compact"
              title="No groups"
              description="This artifact does not contain groups for the selected dimension."
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export function CrossDatasetView() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const search = searchParams.toString();
  if (view === "facts") return <CrossDatasetFactsView search={search} />;
  if (view === "fact") {
    return (
      <CrossDatasetFactDetailView
        factKey={searchParams.get("fact_key")?.trim() ?? ""}
        search={search}
      />
    );
  }
  return <CrossDatasetOverviewView />;
}
