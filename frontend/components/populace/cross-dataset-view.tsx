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
  buildChronicleSourceGapRows,
  buildGroupRows,
  buildSourceOverviews,
  crossDatasetUiState,
  orderSourceSummaries,
  sourceDisplayLabel,
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

function PerformanceBar({
  value,
  label,
}: {
  value: number | null;
  label: string;
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
        className="h-full rounded-full bg-primary"
        style={{ width: String(width) + "%" }}
      />
    </div>
  );
}

function InlineCounts({ values, empty }: { values: LabeledCount[]; empty: string }) {
  if (!values.length) return <>{empty}</>;
  return (
    <>
      {values
        .map((item) => `${item.label}: ${item.count.toLocaleString("en-US")}`)
        .join(" · ")}
    </>
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
  const microcosmSourceId = orderedSources.find((source) =>
    source.source_id.toLowerCase().includes("populace"),
  )?.source_id;
  const microcosmGapRows = useMemo(
    () =>
      query.data && microcosmSourceId
        ? buildChronicleSourceGapRows(query.data.groups.groups, microcosmSourceId)
        : [],
    [microcosmSourceId, query.data],
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
        eyebrow="Microcosm · cross-dataset"
        title={CROSS_DATASET_PAGE_TITLE}
        description={
          <>
            Every model or standalone dataset is classified against the complete Chronicle fact
            catalog. Performance measures closeness only among facts the source can evaluate;
            evaluated and missing-fact counts show how much of Chronicle that score represents.
            Higher performance is better, but a high score over few facts is not whole-Chronicle
            accuracy.
          </>
        }
        status={
          <StatusPill tone={summary.matrix_complete ? "success" : "danger"}>
            {summary.matrix_complete ? "Complete capability matrix" : "Incomplete matrix"}
          </StatusPill>
        }
      />

      <div className="rounded-lg border border-[color-mix(in_srgb,var(--info)_35%,var(--border))] bg-[color-mix(in_srgb,var(--info)_6%,var(--card))] px-4 py-3 text-sm">
        <p className="font-medium text-foreground">How to read the comparison</p>
        <p className="mt-1 text-muted-foreground">
          The performance score is 100 × (1 − family-balanced capped mean absolute percentage
          error ÷ 2). Microcosm results marked <strong>direct calibration target</strong> are
          in-sample calibration fit, not independent validation. Results marked{" "}
          <strong>2023 facts aligned to 2024</strong> compare against the 2024 transformation
          produced by the same aging and uprating logic used in the Microcosm build—not a native
          2023 society-wide run. Tax-Calculator’s public CPS rows use its population advanced to
          2024.
        </p>
      </div>

      <SectionCard
        title="Model and dataset performance"
        description="Microcosm is listed first. Every row keeps its performance score next to the exact number of Chronicle facts that contributed to it."
        padded={false}
      >
        <ol className="divide-y divide-border">
          {sourceOverviews.map((source, index) => (
            <li key={source.sourceId} className="px-5 py-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(250px,1.45fr)_minmax(190px,1fr)_minmax(180px,0.85fr)_minmax(160px,0.7fr)]">
                <div>
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
                      {index + 1}
                    </span>
                    <div>
                      <h2 className="text-base font-semibold">{source.label}</h2>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {source.sourceId}
                      </p>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-xs text-muted-foreground">Performance</span>
                    <span className="text-lg font-semibold tabular-nums">{source.scoreLabel}</span>
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
                  <p className="font-mono text-xs text-muted-foreground">
                    Chronicle facts evaluated
                  </p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {source.coverageLabel}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Coverage is retained as a fact count, not a percentage.
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs text-muted-foreground">
                    Chronicle facts missing
                  </p>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {source.unsupportedCount.toLocaleString("en-US")}
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {source.unsupportedCount ? "Not evaluated" : "All represented"}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground lg:grid-cols-3">
                <p>
                  <span className="font-medium text-foreground">Largest gaps:</span>{" "}
                  <InlineCounts values={source.topUnsupportedReasons} empty="None recorded" />
                </p>
                <p>
                  <span className="font-medium text-foreground">Period handling:</span>{" "}
                  <InlineCounts values={source.periodTreatments} empty="None recorded" />
                </p>
                <p>
                  <span className="font-medium text-foreground">Benchmark relationship:</span>{" "}
                  <InlineCounts values={source.calibrationExposures} empty="None recorded" />
                </p>
              </div>

              <p className="mt-3 text-[11px] text-muted-foreground">
                <span className="font-mono">Dataset:</span>{" "}
                {source.datasetVersion ?? "not recorded"}
                <span className="mx-2">·</span>
                <span className="font-mono">Model:</span>{" "}
                {source.modelVersion ?? "not applicable"}
              </p>
            </li>
          ))}
        </ol>
      </SectionCard>

      {microcosmSourceId && (
        <SectionCard
          title="Microcosm gaps by Chronicle source"
          description="Every Chronicle source with at least one fact Microcosm cannot currently evaluate. Counts come from the complete capability matrix, including unsupported facts that have no model result."
          padded={false}
        >
          {microcosmGapRows.length ? (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border bg-muted/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5">Chronicle source</th>
                    <th className="px-4 py-2.5 text-right">Facts</th>
                    <th className="px-4 py-2.5 text-right">Evaluated</th>
                    <th className="px-4 py-2.5 text-right">Missing</th>
                    <th className="px-4 py-2.5">Why facts are missing</th>
                  </tr>
                </thead>
                <tbody>
                  {microcosmGapRows.map((row) => (
                    <tr key={row.key} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">
                        <Link href={row.factHref} className="hover:text-primary hover:underline">
                          {row.label}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {row.factCount.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {row.evaluatedCount.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                        {row.missingCount.toLocaleString("en-US")}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <InlineCounts values={row.missingReasons} empty="No reason recorded" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <EmptyState
                variant="compact"
                title="No Microcosm gaps"
                description="Microcosm can evaluate every fact in this Chronicle snapshot."
              />
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Performance by Chronicle group"
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
                              <PerformanceBar
                                value={cell.performancePercent}
                                label={
                                  sourceDisplayLabel(source) + " performance for " + row.label
                                }
                              />
                            </div>
                            <div className="mt-1 flex justify-end text-[11px] text-muted-foreground">
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
