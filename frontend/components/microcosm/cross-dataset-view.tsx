"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import {
  CrossDatasetFactDetailView,
  CrossDatasetFactsView,
} from "@/components/microcosm/cross-dataset-facts-view";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { apiGet } from "@/lib/api/client";
import type {
  CrossDatasetGroupsDocument,
  CrossDatasetSummary,
  SourceSummary,
} from "@/lib/cross-dataset/artifact";
import {
  CROSS_DATASET_PAGE_TITLE,
  GROUP_DIMENSIONS,
  buildGroupRows,
  buildSourceOverviews,
  crossDatasetUiState,
  orderSourceSummaries,
  sourceCompactLabel,
  sourceDisplayLabel,
  type GroupDimension,
  type GroupSourceView,
  type LabeledCount,
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
        apiGet<CrossDatasetSummary>("/microcosm/cross-dataset", { view: "summary" }),
        apiGet<CrossDatasetGroupsDocument>("/microcosm/cross-dataset", { view: "groups" }),
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
  coverageLabel,
  unsupportedReasons = [],
  tooltipAlign = "center",
}: {
  buckets: TargetPerformanceBuckets;
  label: string;
  coverageLabel?: string;
  unsupportedReasons?: LabeledCount[];
  tooltipAlign?: "center" | "right";
}) {
  const bucketAriaText = PERFORMANCE_SEGMENTS.map(
    (segment) =>
      `${segment.label}: ${buckets[segment.key].toLocaleString("en-US")}`,
  ).join("; ");
  const reasonAriaText = unsupportedReasons
    .map((reason) => `${reason.label}: ${reason.count.toLocaleString("en-US")}`)
    .join("; ");
  const ariaText = [
    coverageLabel ? `Evaluated facts: ${coverageLabel}` : null,
    bucketAriaText,
    reasonAriaText ? `Leading unavailable reasons: ${reasonAriaText}` : null,
  ]
    .filter(Boolean)
    .join("; ");
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
        className={`pointer-events-none absolute bottom-full z-30 mb-2 w-max max-w-[300px] rounded-md border border-border bg-popover px-3 py-2 text-[11px] text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/validation:opacity-100 group-focus/validation:opacity-100 ${
          tooltipAlign === "right" ? "right-0" : "left-1/2 -translate-x-1/2"
        }`}
      >
        {coverageLabel && (
          <div className="mb-1.5 flex items-center justify-between gap-6 border-b border-border pb-1.5">
            <span>Evaluated facts</span>
            <span className="font-mono tabular-nums">{coverageLabel}</span>
          </div>
        )}
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
        {unsupportedReasons.length > 0 && (
          <div className="mt-1.5 border-t border-border pt-1.5">
            <div className="mb-1 text-muted-foreground">Leading unavailable reasons</div>
            {unsupportedReasons.map((reason) => (
              <div key={reason.key} className="flex items-center justify-between gap-6">
                <span>{reason.label}</span>
                <span className="font-mono tabular-nums">
                  {reason.count.toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GroupMetricCell({
  source,
  groupLabel,
  cell,
  showSourceLabel = false,
  tooltipAlign = "center",
}: {
  source: SourceSummary;
  groupLabel: string;
  cell: GroupSourceView;
  showSourceLabel?: boolean;
  tooltipAlign?: "center" | "right";
}) {
  const fullSourceLabel = sourceDisplayLabel(source);
  return (
    <Link
      href={cell.factHref}
      className="group block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`View ${groupLabel} facts for ${fullSourceLabel}`}
    >
      {showSourceLabel && (
        <span
          className="mb-1.5 block truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          title={fullSourceLabel}
        >
          {sourceCompactLabel(source)}
        </span>
      )}
      <span className="block font-semibold tabular-nums group-hover:text-primary">
        {cell.scoreLabel}
      </span>
      <span className="mt-0.5 block text-xs tabular-nums text-foreground/70">
        {cell.coverageRateLabel}
      </span>
      <div className="mt-2">
        <TargetPerformanceBar
          buckets={cell.performanceBuckets}
          coverageLabel={cell.coverageLabel}
          unsupportedReasons={cell.topUnsupportedReasons}
          tooltipAlign={tooltipAlign}
          label={`${fullSourceLabel} target performance distribution for ${groupLabel}`}
        />
      </div>
    </Link>
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
  const [performanceFilter, setPerformanceFilter] = useState<SourceOverviewFilter>({
    geography: "all",
    sample: "all",
  });
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
            performanceFilter,
          )
        : [],
    [performanceFilter, query.data],
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
          independent validation. The Sample selector uses that Microcosm membership as
          one shared fact set for every model and dataset. Results marked{" "}
          <strong>2023 facts aligned to 2024</strong> compare against the 2024 transformation
          produced by the same aging and uprating logic used in the Microcosm build—not a native
          2023 society-wide run. Tax-Calculator’s public CPS rows use its population advanced to
          2024.
        </p>
        <PerformanceLegend />
      </div>

      <SectionCard
        title="Model and dataset performance"
        actions={
          <div className="flex flex-wrap items-end justify-end gap-3">
            <label className="text-xs text-muted-foreground">
              Geography
              <select
                value={performanceFilter.geography}
                onChange={(event) =>
                  setPerformanceFilter((current) => ({
                    ...current,
                    geography: event.target.value as OverviewGeographyFilter,
                  }))
                }
                className="mt-1 block min-w-[150px] rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground"
                aria-label="Filter all models by geography"
              >
                <option value="all">All geographies</option>
                <option value="country">National</option>
                <option value="state">State</option>
                <option value="congressional_district">Congressional district</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Sample
              <select
                value={performanceFilter.sample}
                onChange={(event) =>
                  setPerformanceFilter((current) => ({
                    ...current,
                    sample: event.target.value as OverviewSampleFilter,
                  }))
                }
                className="mt-1 block min-w-[140px] rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground"
                aria-label="Filter all models by sample"
              >
                <option value="all">All targets</option>
                <option value="in_sample">In Microcosm sample</option>
                <option value="out_of_sample">Out of Microcosm sample</option>
              </select>
            </label>
          </div>
        }
        padded={false}
      >
        <ol className="divide-y divide-border">
          {sourceOverviews.map((source, index) => (
            <li key={source.sourceId} className="px-5 py-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(250px,1.45fr)_minmax(240px,1fr)]">
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
          <div className="group-matrix-container">
            <div className="group-matrix-wide overflow-visible">
              <table className="w-full min-w-[960px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[220px]" />
                  {orderedSources.map((source) => (
                    <col key={source.source_id} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="border-b border-border bg-muted/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5">Chronicle group</th>
                    {orderedSources.map((source) => (
                      <th key={source.source_id} className="px-4 py-2.5">
                        <span title={sourceDisplayLabel(source)}>
                          {sourceCompactLabel(source)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-border last:border-0 hover:bg-muted/20"
                    >
                      <th className="px-4 py-3 text-left align-top" scope="row">
                        <span className="block font-medium">{row.label}</span>
                        <span className="mt-1 block font-mono text-[11px] font-normal tabular-nums text-muted-foreground">
                          {row.factCount.toLocaleString("en-US")} facts
                        </span>
                      </th>
                      {orderedSources.map((source, sourceIndex) => (
                        <td key={source.source_id} className="px-4 py-3 align-top">
                          <GroupMetricCell
                            source={source}
                            groupLabel={row.label}
                            cell={row.sources[source.source_id]}
                            tooltipAlign={
                              sourceIndex === orderedSources.length - 1 ? "right" : "center"
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              className="group-matrix-compact text-sm"
              role="table"
              aria-label="Error by Chronicle group"
            >
              <div
                className="grid grid-cols-[minmax(110px,30%)_minmax(0,1fr)] border-b border-border bg-muted/10 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                role="row"
              >
                <div className="px-3 py-2.5" role="columnheader">
                  Chronicle group
                </div>
                <div className="px-3 py-2.5" role="columnheader">
                  Sources
                </div>
              </div>
              {groupRows.map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[minmax(110px,30%)_minmax(0,1fr)] border-b border-border last:border-0"
                  role="row"
                >
                  <div className="px-3 py-3" role="rowheader">
                    <span className="block break-words font-medium">{row.label}</span>
                    <span className="mt-1 block font-mono text-[10px] tabular-nums text-muted-foreground">
                      {row.factCount.toLocaleString("en-US")} facts
                    </span>
                  </div>
                  <div className="group-matrix-source-grid grid gap-px bg-border">
                    {orderedSources.map((source) => (
                      <div key={source.source_id} className="bg-card p-3" role="cell">
                        <GroupMetricCell
                          source={source}
                          groupLabel={row.label}
                          cell={row.sources[source.source_id]}
                          showSourceLabel
                          tooltipAlign="right"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
