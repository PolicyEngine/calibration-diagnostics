"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { apiGet } from "@/lib/api/client";
import type {
  CrossDatasetFact,
  CrossDatasetSummary,
  FactsPage,
} from "@/lib/cross-dataset/artifact";
import {
  buildFactDetailView,
  buildFactRowView,
  factCatalogHref,
  parseFactCatalogParams,
  type DisplayField,
  type FactCatalogParams,
} from "@/lib/cross-dataset/fact-presentation";
import { sourceDisplayLabel } from "@/lib/cross-dataset/presentation";

interface CatalogResponse {
  summary: CrossDatasetSummary;
  page: FactsPage;
}

interface FactResponse {
  fact: CrossDatasetFact;
}

const STATUS_OPTIONS = [
  ["", "All capabilities"],
  ["evaluable_direct", "Evaluable · direct"],
  ["evaluable_via_model", "Evaluable · via model"],
  ["evaluable_in_sample", "Evaluable · in-sample"],
  ["evaluable_projected", "Evaluable · projected"],
  ["unsupported_concept", "Unsupported · concept"],
  ["unsupported_constraint", "Unsupported · constraint"],
  ["unsupported_entity", "Unsupported · entity"],
  ["unsupported_geography", "Unsupported · geography"],
  ["unsupported_period", "Unsupported · period"],
  ["not_applicable", "Not applicable"],
] as const;

const SORT_OPTIONS = [
  ["fact_key", "Fact ID"],
  ["label", "Fact label"],
  ["error_desc", "Largest error"],
] as const;

function apiFactParams(params: FactCatalogParams): Record<string, string | number | undefined> {
  return {
    view: "facts",
    source: params.source || undefined,
    status: params.status || undefined,
    ledger_source: params.ledgerSource || undefined,
    measure: params.measure || undefined,
    period: params.period || undefined,
    geography: params.geography || undefined,
    period_treatment: params.periodTreatment || undefined,
    calibration_exposure: params.calibrationExposure || undefined,
    search: params.search || undefined,
    page: params.page,
    page_size: params.pageSize,
    sort: params.sort,
  };
}

function useFactCatalog(params: FactCatalogParams) {
  return useQuery({
    queryKey: ["cross-dataset", "facts", params],
    queryFn: async (): Promise<CatalogResponse> => {
      const [summary, page] = await Promise.all([
        apiGet<CrossDatasetSummary>("/microcosm/cross-dataset", { view: "summary" }),
        apiGet<FactsPage>("/microcosm/cross-dataset", apiFactParams(params)),
      ]);
      if (summary.run_id !== page.run_id || summary.snapshot_id !== page.snapshot_id) {
        throw new Error("Cross-dataset catalog and summary belong to different runs.");
      }
      return { summary, page };
    },
    placeholderData: (previous) => previous,
    staleTime: Infinity,
    retry: false,
  });
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActiveFilter({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[260px] truncate font-mono" title={value}>
        {value}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
        aria-label={"Remove " + label + " filter"}
      >
        ×
      </button>
    </span>
  );
}

function sourceTone(supported: boolean): "success" | "neutral" {
  return supported ? "success" : "neutral";
}

export function CrossDatasetFactsView({ search }: { search: string }) {
  const router = useRouter();
  const params = useMemo(
    () => parseFactCatalogParams(new URLSearchParams(search)),
    [search],
  );
  const query = useFactCatalog(params);
  const [searchInput, setSearchInput] = useState(params.search);

  useEffect(() => setSearchInput(params.search), [params.search]);

  const navigate = (patch: Partial<FactCatalogParams>) => {
    router.push(factCatalogHref(params, { ...patch, page: patch.page ?? 1 }));
  };

  if (query.isLoading && !query.data) {
    return <LoadingBlock label="Loading Chronicle fact catalog…" />;
  }
  if (query.error || !query.data) {
    return (
      <EmptyState
        title="Chronicle fact catalog unavailable"
        description={query.error instanceof Error ? query.error.message : "Unknown error."}
        actions={
          <button
            type="button"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        }
      />
    );
  }

  const { summary, page } = query.data;
  const selectedSources = params.source
    ? summary.sources.filter((source) => source.source_id === params.source)
    : summary.sources;
  const activeSource = summary.sources.find((source) => source.source_id === params.source);
  const rows = page.rows.map((fact) => buildFactRowView(fact, selectedSources, params));
  const sourceOptions: readonly (readonly [string, string])[] = [
    ["", "All sources"] as const,
    ...summary.sources.map((source) => [source.source_id, sourceDisplayLabel(source)] as const),
  ];
  const filterValues: {
    key: keyof FactCatalogParams;
    label: string;
    value: string;
  }[] = [
    { key: "ledgerSource", label: "Chronicle source", value: params.ledgerSource },
    { key: "measure", label: "Concept", value: params.measure },
    { key: "period", label: "Period", value: params.period },
    { key: "geography", label: "Geography", value: params.geography },
    { key: "periodTreatment", label: "Period treatment", value: params.periodTreatment },
    {
      key: "calibrationExposure",
      label: "Calibration exposure",
      value: params.calibrationExposure,
    },
  ];
  const activeFilters = filterValues.filter((filter) => filter.value);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Cross-dataset · Chronicle facts"
        title="Chronicle fact catalog"
        description="Browse every Chronicle observation and the corresponding capability cell for each model. Unsupported cells remain visible with a specific reason."
        actions={
          <Link
            href="/microcosm/datasets"
            className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            ← Overview
          </Link>
        }
        status={
          <StatusPill tone="info">
            {page.total.toLocaleString("en-US")} matching facts
          </StatusPill>
        }
      />

      <SectionCard
        title="Filter facts"
        description="Filters are encoded in the URL so a specific comparison can be shared and revisited."
      >
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex min-w-[260px] flex-1 items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ search: searchInput });
            }}
          >
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
              Search
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Fact label, ID, or measure"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:brightness-95"
            >
              Search
            </button>
          </form>
          <FilterSelect
            label="Source"
            value={params.source}
            options={sourceOptions}
            onChange={(source) =>
              navigate({
                source,
                status: source ? params.status : "",
                sort: !source && params.sort === "error_desc" ? "fact_key" : params.sort,
              })
            }
          />
          <FilterSelect
            label="Capability"
            value={params.status}
            options={STATUS_OPTIONS}
            onChange={(status) => navigate({ status })}
            disabled={!params.source}
          />
          <FilterSelect
            label="Sort"
            value={params.sort}
            options={SORT_OPTIONS}
            onChange={(sort) => navigate({ sort: sort as FactCatalogParams["sort"] })}
          />
        </div>
        {(activeFilters.length > 0 || params.search || params.source || params.status) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {params.source && (
              <ActiveFilter
                label="Source"
                value={activeSource ? sourceDisplayLabel(activeSource) : params.source}
                onRemove={() => navigate({ source: "", status: "", sort: "fact_key" })}
              />
            )}
            {params.status && (
              <ActiveFilter
                label="Capability"
                value={params.status}
                onRemove={() => navigate({ status: "" })}
              />
            )}
            {params.search && (
              <ActiveFilter
                label="Search"
                value={params.search}
                onRemove={() => navigate({ search: "" })}
              />
            )}
            {activeFilters.map((filter) => (
              <ActiveFilter
                key={filter.key}
                label={filter.label}
                value={filter.value}
                onRemove={() => navigate({ [filter.key]: "" })}
              />
            ))}
            <Link
              href="/microcosm/datasets?view=facts"
              className="ml-auto text-xs font-medium text-primary underline underline-offset-2"
            >
              Clear all
            </Link>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Facts"
        description={
          "Page " +
          page.page.toLocaleString("en-US") +
          " of " +
          Math.max(1, page.page_count).toLocaleString("en-US") +
          " · " +
          page.total.toLocaleString("en-US") +
          " matching facts"
        }
        padded={false}
      >
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/10 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="min-w-[280px] px-4 py-2.5">
                    Chronicle fact
                  </th>
                  <th scope="col" className="min-w-[150px] px-4 py-2.5">
                    Observation
                  </th>
                  {selectedSources.map((source) => (
                    <th
                      scope="col"
                      key={source.source_id}
                      className="min-w-[220px] px-4 py-2.5"
                    >
                      {sourceDisplayLabel(source)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.factKey} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={row.detailHref}
                        aria-label={row.detailAriaLabel}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {row.label}
                      </Link>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {row.measure}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.ledgerSource} · {row.geography}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold tabular-nums">{row.observedValue}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{row.observedPeriod}</div>
                    </td>
                    {selectedSources.map((source) => {
                      const cell = row.sourceCells[source.source_id];
                      return (
                        <td
                          key={source.source_id}
                          className="px-4 py-3 align-top"
                          aria-label={cell.ariaLabel}
                        >
                          <StatusPill tone={sourceTone(cell.supported)}>
                            {cell.statusLabel}
                          </StatusPill>
                          <div className="mt-2 font-semibold tabular-nums">
                            {cell.estimateLabel}
                          </div>
                          {cell.errorLabel && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {cell.errorLabel}
                            </div>
                          )}
                          {!cell.supported && cell.reasonLabel && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {cell.reasonLabel}
                            </div>
                          )}
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
              title="No matching facts"
              description="Change or clear the current filters."
            />
          </div>
        )}
      </SectionCard>

      <nav
        className="flex items-center justify-between gap-3"
        aria-label="Chronicle fact catalog pagination"
      >
        {page.page > 1 ? (
          <Link
            href={factCatalogHref(params, { page: page.page - 1 })}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="font-mono text-xs text-muted-foreground">
          Page {page.page.toLocaleString("en-US")} / {Math.max(1, page.page_count).toLocaleString("en-US")}
        </span>
        {page.page < page.page_count ? (
          <Link
            href={factCatalogHref(params, { page: page.page + 1 })}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            Next →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}

function FieldList({ fields, empty }: { fields: DisplayField[]; empty: string }) {
  if (!fields.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <dl className="divide-y divide-border">
      {fields.map((field, index) => (
        <div key={field.label + String(index)} className="grid gap-1 py-2 sm:grid-cols-[160px_1fr]">
          <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
          <dd className="break-all font-mono text-xs text-foreground">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function useFactDetail(factKey: string) {
  return useQuery({
    queryKey: ["cross-dataset", "fact", factKey],
    queryFn: async () => {
      const [summary, response] = await Promise.all([
        apiGet<CrossDatasetSummary>("/microcosm/cross-dataset", { view: "summary" }),
        apiGet<FactResponse>("/microcosm/cross-dataset", {
          view: "fact",
          fact_key: factKey,
        }),
      ]);
      return { summary, fact: response.fact };
    },
    enabled: Boolean(factKey),
    staleTime: Infinity,
    retry: false,
  });
}

export function CrossDatasetFactDetailView({
  factKey,
  search,
}: {
  factKey: string;
  search: string;
}) {
  const context = useMemo(
    () => parseFactCatalogParams(new URLSearchParams(search)),
    [search],
  );
  const query = useFactDetail(factKey);
  if (!factKey) {
    return (
      <EmptyState
        title="No Chronicle fact selected"
        description="Choose a fact from the catalog."
        actions={
          <Link className="text-xs text-primary underline" href={factCatalogHref(context)}>
            Open fact catalog
          </Link>
        }
      />
    );
  }
  if (query.isLoading) return <LoadingBlock label="Loading Chronicle fact…" />;
  if (query.error || !query.data) {
    return (
      <EmptyState
        title="Chronicle fact unavailable"
        description={query.error instanceof Error ? query.error.message : "Unknown error."}
        actions={
          <Link className="text-xs text-primary underline" href={factCatalogHref(context)}>
            Back to fact catalog
          </Link>
        }
      />
    );
  }

  const { summary, fact } = query.data;
  const detail = buildFactDetailView(fact, summary.sources);
  const provenanceUrl = fact.provenance?.url;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Cross-dataset · single fact"
        title={detail.label}
        description={detail.measure}
        actions={
          <Link
            href={factCatalogHref(context)}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            ← Fact catalog
          </Link>
        }
        status={<StatusPill tone="info">{detail.observation.periodLabel}</StatusPill>}
      />

      <SectionCard
        title="Original Chronicle observation"
        description="This is the published fact as stored in the pinned Chronicle snapshot. Any aligned comparison value appears separately below."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Observed value", detail.observation.valueLabel],
            ["Observed period", detail.observation.periodLabel],
            ["Chronicle source", detail.observation.sourceLabel],
            ["Geography", detail.observation.geographyLabel],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="font-mono text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 font-semibold">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
          {detail.factKey}
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        {summary.sources.map((source) => {
          const cell = detail.sourceCells[source.source_id];
          return (
            <section
              key={source.source_id}
              className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--elev-1)]"
              aria-label={cell.ariaLabel}
            >
              <div className="border-b border-border bg-muted/20 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{sourceDisplayLabel(source)}</h2>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {source.source_id}
                    </p>
                  </div>
                  <StatusPill tone={sourceTone(cell.supported)}>
                    {cell.statusLabel}
                  </StatusPill>
                </div>
              </div>

              <div className="space-y-5 p-5">
                {cell.supported ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-md border border-border p-3">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          Source estimate
                        </div>
                        <div className="mt-1 text-lg font-semibold tabular-nums">
                          {cell.estimateLabel}
                        </div>
                      </div>
                      <div className="rounded-md border border-border p-3">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          Comparison benchmark
                        </div>
                        <div className="mt-1 text-lg font-semibold tabular-nums">
                          {cell.benchmarkLabel}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {cell.benchmarkPeriodLabel} · {cell.benchmarkBasisLabel}
                        </div>
                      </div>
                      <div className="rounded-md border border-border p-3">
                        <div className="font-mono text-[11px] text-muted-foreground">
                          Absolute relative error
                        </div>
                        <div className="mt-1 text-lg font-semibold tabular-nums">
                          {cell.errorLabel || "Not defined"}
                        </div>
                      </div>
                    </div>

                    {(cell.benchmarkPeriodLabel !== detail.observation.periodLabel ||
                      cell.benchmarkLabel !== detail.observation.valueLabel) && (
                      <div className="rounded-md border border-[color-mix(in_srgb,var(--warn)_35%,var(--border))] bg-[color-mix(in_srgb,var(--warn)_5%,var(--card))] px-3 py-2 text-xs text-muted-foreground">
                        The score uses <strong>{cell.benchmarkLabel}</strong> for{" "}
                        <strong>{cell.benchmarkPeriodLabel}</strong>, not the original{" "}
                        {detail.observation.valueLabel} observation for{" "}
                        {detail.observation.periodLabel}. The alignment record below explains the
                        transformation.
                      </div>
                    )}

                    {cell.standardErrorLabel !== "Not available" && (
                      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        Sampling uncertainty: standard error{" "}
                        <strong>{cell.standardErrorLabel}</strong> · 90% margin of error ±
                        <strong>{cell.marginOfError90Label}</strong>. The score still uses the
                        point estimate above.
                      </div>
                    )}

                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">
                          Execution and mapping
                        </h3>
                        <FieldList
                          empty="No mapping metadata"
                          fields={[
                            { label: "Execution", value: cell.executionLabel },
                            { label: "Mapping", value: cell.mappingLabel },
                            { label: "Calibration exposure", value: cell.calibrationExposureLabel },
                            { label: "Dataset version", value: cell.datasetVersion },
                            { label: "Model version", value: cell.modelVersion },
                            { label: "Standard error", value: cell.standardErrorLabel },
                            { label: "90% margin of error", value: cell.marginOfError90Label },
                            {
                              label: "Required variables",
                              value: cell.requiredVariables.length
                                ? cell.requiredVariables.join(", ")
                                : "None recorded",
                            },
                          ]}
                        />
                      </div>
                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">
                          Periods
                        </h3>
                        <FieldList
                          empty="No period metadata"
                          fields={[
                            { label: "Fact period", value: detail.observation.periodLabel },
                            { label: "Population period", value: cell.populationPeriodLabel },
                            { label: "Policy period", value: cell.policyPeriodLabel },
                            { label: "Period treatment", value: cell.periodTreatmentLabel },
                            { label: "Benchmark period", value: cell.benchmarkPeriodLabel },
                          ]}
                        />
                      </div>
                    </div>

                    {cell.alignment.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">
                          Alignment record
                        </h3>
                        <FieldList fields={cell.alignment} empty="No alignment applied" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-muted/20 p-4">
                    <p className="font-medium">This source cannot evaluate the fact.</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {cell.reasonLabel || "No reason was recorded."}
                    </p>
                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Mapping</dt>
                        <dd className="font-mono">{cell.mappingLabel}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Period treatment</dt>
                        <dd className="font-mono">{cell.periodTreatmentLabel}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Dimensions">
          <FieldList fields={detail.dimensions} empty="No dimensions" />
        </SectionCard>
        <SectionCard title="Universe constraints">
          <FieldList fields={detail.universe} empty="No universe constraints" />
        </SectionCard>
        <SectionCard
          title="Chronicle provenance"
          actions={
            typeof provenanceUrl === "string" && provenanceUrl.startsWith("http") ? (
              <a
                href={provenanceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline"
              >
                Open source ↗
              </a>
            ) : undefined
          }
        >
          <FieldList fields={detail.provenance} empty="No provenance metadata" />
        </SectionCard>
      </div>
    </div>
  );
}
