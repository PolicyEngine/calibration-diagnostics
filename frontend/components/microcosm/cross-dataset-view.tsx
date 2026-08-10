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
  orderSourceSummaries,
  sourceDisplayLabel,
  type GroupDimension,
  type OverviewGeographyFilter,
  type OverviewSampleFilter,
  type SourceOverviewFilter,
  type TargetPerformanceBuckets,
} from "@/lib/cross-dataset/presentation";

interface OverviewResponse {
  summary: CrossDatasetSummary;
  groups: CrossDatasetGroupsDocument;
}

function useCrossDatasetOverview() {
  return useQuery({
    queryKey: ["cross-dataset", "overview", "v3"],
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

const PERFORMANCE_SEGMENTS = [
  { key: "withinBounds", label: "Within 10%", className: "bg-emerald-500" },
  { key: "outsideBounds", label: "10–25% error", className: "bg-amber-400" },
  { key: "farOutsideBounds", label: "Over 25% error", className: "bg-red-500" },
  {
    key: "unavailable",
    label: "No mapping / no comparable error",
    className: "bg-zinc-700",
  },
] as const;

function TargetPerformanceBar({
  buckets,
  label,
}: {
  buckets: TargetPerformanceBuckets;
  label: string;
}) {
  const ariaText = PERFORMANCE_SEGMENTS.map(
    (segment) =>
      `${segment.label}: ${buckets[segment.key].toLocaleString("en-US")}`,
  ).join("; ");
  return (
    <div className="group/validation relative" tabIndex={0}>
      <div
        className="flex h-2 cursor-help overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={label}
        aria-description={buckets.total ? ariaText : "No targets in this group"}
      >
        {PERFORMANCE_SEGMENTS.map((segment) => {
          const count = buckets[segment.key];
          if (!count || !buckets.total) return null;
          return (
            <span
              key={segment.key}
              className={`h-full ${segment.className}`}
              style={{ width: `${(count / buckets.total) * 100}%` }}
            />
          );
        })}
      </div>
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[280px] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-[11px] text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/validation:opacity-100 group-focus/validation:opacity-100"
      >
        {PERFORMANCE_SEGMENTS.map((segment) => (
          <div key={segment.key} className="flex items-center justify-between gap-6">
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-sm ${segment.className}`} aria-hidden="true" />
              {segment.label}
            </span>
            <span className="font-mono tabular-nums">
              {buckets[segment.key].toLocaleString("en-US")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformanceLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {PERFORMANCE_SEGMENTS.map((segment) => (
        <span key={segment.key} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${segment.className}`} aria-hidden="true" />
          {segment.label}
        </span>
      ))}
    </div>
  );
}

function CrossDatasetOverviewView() {
  const query = useCrossDatasetOverview();
  const [dimension, setDimension] = useState<GroupDimension>("ledger_source");
  const [sourceFilters, setSourceFilters] = useState<
    Record<string, SourceOverviewFilter>
  >({});
  const state = crossDatasetUiState({
    isLoading: query.isLoading,
    error: query.error,
    summary: query.data?.summary,
  });

  const sourceOverviews = useMemo(
    () =>
      query.data
        ? buildSourceOverviews(
            query.data.summary,
            query.data.groups.groups,
            sourceFilters,
          )
        : [],
    [query.data, sourceFilters],
  );
  const orderedSources = useMemo(
    () => (query.data ? orderSourceSummaries(query.data.summary.sources) : []),
    [query.data],
  );
  const groupRows = useMemo(
    () =>
      query.data
        ? buildGroupRows(query.data.groups.groups, dimension, orderedSources)
        : [],
    [dimension, orderedSources, query.data],
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

  const updateSourceFilter = <Key extends keyof SourceOverviewFilter>(
    sourceId: string,
    key: Key,
    value: SourceOverviewFilter[Key],
  ) => {
    setSourceFilters((current) => ({
      ...current,
      [sourceId]: {
        geography: current[sourceId]?.geography ?? "all",
        sample: current[sourceId]?.sample ?? "all",
        [key]: value,
      },
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Microcosm · cross-dataset"
        title={CROSS_DATASET_PAGE_TITLE}
        description={
          <>
            Every model or standalone dataset is classified against the complete US Chronicle
            fact catalog. Non-US facts are excluded before classification. Error measures
            closeness only among comparable facts executed by the current adapter, using the
            same fact-level 100%-capped approach as the calibration fit view.
          </>
        }
      />

      <div className="rounded-lg border border-[color-mix(in_srgb,var(--info)_35%,var(--border))] bg-[color-mix(in_srgb,var(--info)_6%,var(--card))] px-4 py-3 text-sm">
        <p className="font-medium text-foreground">How to read the comparison</p>
        <p className="mt-1 text-muted-foreground">
          The reported value is the fact-level mean absolute relative error, with each fact’s
          error capped at 100% before averaging. Lower is better. Microcosm results marked{" "}
          <strong>direct calibration target</strong> are in-sample calibration fit, not
          independent validation. Results marked{" "}
          <strong>2023 facts aligned to 2024</strong> compare against the 2024 transformation
          produced by the same aging and uprating logic used in the Microcosm build—not a native
          2023 society-wide run. Tax-Calculator’s public CPS rows use its population advanced to
          2024.
        </p>
        <PerformanceLegend />
      </div>

      <SectionCard
        title="Model and dataset performance"
        padded={false}
      >
        <ol className="divide-y divide-border">
          {sourceOverviews.map((source, index) => (
            <li key={source.sourceId} className="px-5 py-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(250px,1.45fr)_minmax(190px,1fr)_minmax(220px,0.9fr)]">
                <div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <h2 className="text-base font-semibold">{source.label}</h2>
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-end">
                    <span className="flex items-baseline gap-2 text-base font-medium tabular-nums text-foreground/80">
                      <span>{source.scoreLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{source.coverageRateLabel}</span>
                    </span>
                  </div>
                  <div className="mt-2">
                    <TargetPerformanceBar
                      buckets={source.performanceBuckets}
                      label={source.label + " target performance distribution"}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <label className="text-xs text-muted-foreground">
                    Geography
                    <select
                      value={sourceFilters[source.sourceId]?.geography ?? "all"}
                      onChange={(event) =>
                        updateSourceFilter(
                          source.sourceId,
                          "geography",
                          event.target.value as OverviewGeographyFilter,
                        )
                      }
                      className="mt-1 block w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground"
                      aria-label={`Filter ${source.label} by geography`}
                    >
                      <option value="all">All geographies</option>
                      <option value="country">National</option>
                      <option value="state">State</option>
                      <option value="congressional_district">Congressional district</option>
                    </select>
                  </label>
                  {source.sourceId.toLowerCase().includes("populace") && (
                    <label className="text-xs text-muted-foreground">
                      Sample
                      <select
                        value={sourceFilters[source.sourceId]?.sample ?? "all"}
                        onChange={(event) =>
                          updateSourceFilter(
                            source.sourceId,
                            "sample",
                            event.target.value as OverviewSampleFilter,
                          )
                        }
                        className="mt-1 block w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground"
                        aria-label={`Filter ${source.label} by sample`}
                      >
                        <option value="all">All targets</option>
                        <option value="in_sample">In sample</option>
                        <option value="out_of_sample">Out of sample</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard
        title="Error by Chronicle group"
        description="Each cell shows fact-level mean error after capping each comparable fact at 100%. Select a grouping to inspect the underlying facts and why others were not evaluated in this run."
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
                  <th className="px-4 py-2.5 text-right">Chronicle facts</th>
                  {orderedSources.map((source) => (
                    <th key={source.source_id} className="min-w-[220px] px-4 py-2.5">
                      {sourceDisplayLabel(source)}
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
                    {orderedSources.map((source) => {
                      const cell = row.sources[source.source_id];
                      return (
                        <td key={source.source_id} className="px-4 py-3 align-top">
                          <Link
                            href={cell.factHref}
                            className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label={
                              "View " + row.label + " facts for " + sourceDisplayLabel(source)
                            }
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
                              <TargetPerformanceBar
                                buckets={cell.performanceBuckets}
                                label={
                                  sourceDisplayLabel(source) +
                                  " target performance distribution for " +
                                  row.label
                                }
                              />
                            </div>
                            <div className="mt-1 flex justify-end text-[11px] text-muted-foreground">
                              <span>
                                {cell.unsupportedCount
                                  ? cell.unsupportedCount.toLocaleString("en-US") + " not evaluated"
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
