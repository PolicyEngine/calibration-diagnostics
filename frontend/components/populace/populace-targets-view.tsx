"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, humanizeName, releaseLabel } from "@/components/shared/format";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import { PopulaceTargetDetail } from "@/components/populace/populace-target-detail";
import {
  usePopulaceReleases,
  usePopulaceTargetDiagnostics,
  type PopulaceTargetDimension,
  type PopulaceTargetRow,
  type PopulaceVariableRow,
} from "@/lib/api/hooks/use-populace";

const PAGE_SIZE = 50;

interface SortState {
  by: string;
  dir: "asc" | "desc";
}

interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  render: (row: PopulaceTargetRow) => React.ReactNode;
}

interface VariableMeasureOption {
  key: string;
  label: string;
  row: PopulaceVariableRow;
}

interface VariableGroup {
  groupKey: string;
  source: string;
  variable: string;
  level: string;
  options: VariableMeasureOption[];
  defaultKey: string;
  nTargets: number;
  within10Pct: number;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}

function finalError(row: PopulaceTargetRow) {
  if (row.error_kind === "absolute") return fmtCompact(row.final_error);
  return fmt(row.final_error, { pct: true, digits: 1 });
}

function titleFromIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const leaf = value.split(/[.#:]/).filter(Boolean).at(-1) ?? value;
  return humanizeName(leaf.replace(/[^a-zA-Z0-9]+/g, "_"));
}

function measureTitle(row: PopulaceTargetRow): string {
  return (
    titleFromIdentifier(row.ledger?.measure_concept) ||
    humanizeName(row.variable as string) ||
    titleFromIdentifier(row.ledger?.layout_measure_id) ||
    "—"
  );
}

function periodTitle(row: PopulaceTargetRow): string {
  const target = row.ledger?.target_period ?? (row.period == null ? null : String(row.period));
  const source = row.ledger?.source_period;
  if (target && source && target !== source) return `${source} → ${target}`;
  return target ?? source ?? "—";
}

function dimensionSummary(row: PopulaceTargetRow): string {
  const dims = row.target_dimensions?.map((dim) => dim.value).filter(Boolean) ?? [];
  if (dims.length) return dims.join(" · ");
  const group = row.ledger?.layout_groupby_value_id;
  if (group && group !== "all") return humanizeName(group);
  return "All";
}

function calibrationStatusTone(
  status: PopulaceTargetRow["calibration_status"],
): "success" | "warning" | "neutral" {
  if (status === "included") return "success";
  if (status === "skipped" || status === "not_materialized") return "warning";
  return "neutral";
}

const STATUS_COLUMN: Column = {
  key: "calibration_status",
  label: "Calibration",
  sortable: true,
  render: (row) => (
    <span title={row.calibration_status_reason ?? undefined}>
      <StatusPill tone={calibrationStatusTone(row.calibration_status)}>
        {row.calibration_status_label ?? "Unknown"}
      </StatusPill>
    </span>
  ),
};

const METRIC_COLUMNS: Column[] = [
  STATUS_COLUMN,
  {
    key: "target",
    label: "Target",
    numeric: true,
    sortable: true,
    render: (row) => fmtCompact(row.target),
  },
  {
    key: "final_estimate",
    label: "Final est.",
    numeric: true,
    sortable: true,
    render: (row) => fmtCompact(row.final_estimate),
  },
  {
    key: "relative_error",
    label: "Error",
    numeric: true,
    sortable: true,
    render: finalError,
  },
];

// Without a variable selected: mirror Arch aggregate_facts concepts in readable
// form. With a variable selected: one column per breakdown dimension.
const OVERVIEW_COLUMNS: Column[] = [
  {
    key: "measure",
    label: "Measure",
    sortable: true,
    render: (row) => (
      <div className="max-w-sm" title={row.ledger?.measure_concept ?? String(row.name ?? "")}>
        <div className="font-medium text-foreground">{measureTitle(row)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {row.ledger?.measure_unit
            ? row.ledger.measure_unit.toUpperCase()
            : row.measure === "total"
              ? "Amount"
              : row.measure === "count"
                ? "Count"
                : row.measure || "—"}
        </div>
      </div>
    ),
  },
  {
    key: "source",
    label: "Source",
    sortable: true,
    render: (row) => (
      <div className="max-w-[11rem]" title={row.ledger?.source_record_id ?? String(row.name ?? "")}>
        <div className="font-medium text-foreground">{row.source || "—"}</div>
        <div className="truncate text-xs text-muted-foreground">
          {titleFromIdentifier(row.ledger?.domain)}
        </div>
      </div>
    ),
  },
  {
    key: "period",
    label: "Period",
    sortable: true,
    render: (row) => (
      <span className="whitespace-nowrap" title={row.ledger?.period_type ?? undefined}>
        {periodTitle(row)}
      </span>
    ),
  },
  {
    key: "geography",
    label: "Geography",
    sortable: true,
    render: (row) => (
      <span className="whitespace-nowrap" title={row.ledger?.geography_id ?? undefined}>
        {row.geography || "—"}
      </span>
    ),
  },
  {
    key: "breakdown",
    label: "Dimensions",
    sortable: true,
    render: (row) => (
      <div className="max-w-md truncate" title={dimensionSummary(row)}>
        {dimensionSummary(row)}
      </div>
    ),
  },
];

// Resolve a facet key ("geography" | "level" | "dim<N>") against a row.
export function rowFacetValue(
  row: PopulaceTargetRow,
  key: string,
): string | undefined {
  if (key === "geography") return row.geography ?? undefined;
  if (key === "level") return row.level ?? undefined;
  const targetDimension = row.target_dimensions?.find((dim) => dim.key === key);
  if (targetDimension) return targetDimension.value;
  const dim = /^dim(\d+)$/.exec(key);
  if (dim) return row.dims?.[Number(dim[1])] ?? undefined;
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function dimensionColumns(dimensions: PopulaceTargetDimension[]): Column[] {
  return dimensions.map((dim) => ({
    key: dim.key,
    label: dim.label,
    sortable: true,
    render: (row: PopulaceTargetRow) => {
      const value = rowFacetValue(row, dim.key);
      return value ? (
        <span className="whitespace-nowrap">{value.replace(/^AGI in /, "")}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    },
  }));
}

function measureLabel(measure: string | null | undefined): string {
  if (!measure || measure === "total") return "Amount";
  if (measure === "count") return "Count";
  return humanizeName(measure);
}

function measureRank(measure: string | null | undefined): number {
  if (!measure || measure === "total") return 0;
  if (measure === "count") return 1;
  return 2;
}

function groupVariables(variables: PopulaceVariableRow[]): VariableGroup[] {
  const groups = new Map<string, PopulaceVariableRow[]>();
  for (const variable of variables) {
    const key = [
      variable.source,
      variable.level,
      variable.variable,
    ].join("::");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(variable);
  }

  return [...groups.entries()]
    .map(([groupKey, rows]) => {
      const sortedRows = [...rows].sort((a, b) => {
        const rank = measureRank(a.measure) - measureRank(b.measure);
        return rank || measureLabel(a.measure).localeCompare(measureLabel(b.measure));
      });
      const first = sortedRows[0];
      const options = sortedRows.map((row) => ({
        key: row.variable_key,
        label: measureLabel(row.measure),
        row,
      }));
      const defaultOption =
        options.find((option) => option.row.measure === "total" || !option.row.measure) ??
        options[0];
      const nTargets = sortedRows.reduce((sum, row) => sum + row.n_targets, 0);
      const within10Pct = sortedRows.reduce((sum, row) => sum + row.within_10pct, 0);
      return {
        groupKey,
        source: first.source,
        variable: first.variable,
        level: first.level,
        options,
        defaultKey: defaultOption.key,
        nTargets,
        within10Pct,
      };
    })
    .sort((a, b) => b.nTargets - a.nTargets);
}

function VariableBrowser({
  variables,
  active,
  onPick,
}: {
  variables: PopulaceVariableRow[];
  active: string;
  onPick: (variableKey: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupVariables(variables), [variables]);
  const filtered = query
    ? groups.filter((group) => {
        const haystack = [
          group.variable,
          group.source,
          group.level,
          ...group.options.map((option) => option.row.variable_key),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
    : groups;
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        placeholder="Filter variables…"
        onChange={(event) => setQuery(event.target.value)}
        className="h-8 w-full rounded-md border border-border bg-white px-3 text-xs focus:border-primary/60 focus:outline-none"
      />
      <div className="max-h-[65vh] overflow-y-auto rounded-md border border-border">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
          <span>Variable</span>
          <span className="text-right">Targets</span>
        </div>
        <div className="divide-y divide-border/60">
          {filtered.map((group) => {
            const activeOption = group.options.find((option) => option.key === active);
            const selectedKey = activeOption?.key ?? group.defaultKey;
            const selectedOption =
              group.options.find((option) => option.key === selectedKey) ?? group.options[0];
            const selectedRow = selectedOption.row;
            const isActive = Boolean(activeOption);
            const within10Share = selectedRow.n_targets
              ? selectedRow.within_10pct / selectedRow.n_targets
              : null;
            return (
              <div
                key={group.groupKey}
                role="button"
                tabIndex={0}
                onClick={() => onPick(isActive ? "" : selectedKey)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onPick(isActive ? "" : selectedKey);
                  }
                }}
                className={`block w-full min-w-0 cursor-pointer px-3 py-2 text-left ${
                  isActive ? "bg-primary/10" : "hover:bg-muted/40"
                }`}
              >
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <div className="min-w-0">
                    <div className={`truncate text-sm leading-snug ${isActive ? "font-medium text-primary" : "text-foreground"}`}>
                      {humanizeName(group.variable) || selectedRow.variable_key}
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span>{group.source}</span>
                      {group.level ? <span>{group.level}</span> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums">
                    <div className="font-medium text-foreground">
                      {fmt(selectedRow.n_targets, { digits: 0 })}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {within10Share == null
                        ? "—"
                        : `${fmt(within10Share, { pct: true, digits: 0 })} in 10%`}
                    </div>
                  </div>
                </div>
                <div
                  className="mt-2 flex min-w-0 flex-wrap items-center gap-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  {group.options.length > 1 ? (
                    <div className="inline-flex max-w-full rounded-md border border-border bg-white p-0.5">
                      {group.options.map((option) => {
                        const isSelected = option.key === selectedKey;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => onPick(option.key === active ? "" : option.key)}
                            className={`h-6 min-w-0 px-2 text-[11px] font-medium ${
                              isSelected
                                ? "rounded bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="inline-flex h-6 items-center rounded bg-muted px-2 text-[11px] font-medium text-foreground/70">
                      {selectedOption.label}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PopulaceTargetsView() {
  const [release, setRelease] = useState("");
  const [variable, setVariable] = useState("");
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [geography, setGeography] = useState("");
  const [direction, setDirection] = useState("");
  const [withinTolerance, setWithinTolerance] = useState("");
  const [search, setSearch] = useState("");
  const [facetFilters, setFacetFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<PopulaceTargetRow | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>({ by: "abs_relative_error", dir: "desc" });

  const { data: releaseData } = usePopulaceReleases();
  const releaseOptions = useMemo(
    () => [
      { value: "", label: "Latest" },
      ...(releaseData?.releases ?? []).map((r) => ({
        value: r.release_id,
        label: releaseLabel(r.release_id, r.date),
      })),
    ],
    [releaseData],
  );

  function pickRelease(value: string) {
    // A different release is a different surface — reset everything below it.
    setRelease(value);
    setVariable("");
    setFacetFilters({});
    setSource("");
    setLevel("");
    setGeography("");
    setDirection("");
    setWithinTolerance("");
    setSelected(null);
    setPage(0);
  }

  const facetParam = useMemo(
    () =>
      Object.entries(facetFilters)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}:${value}`),
    [facetFilters],
  );
  const debouncedSearch = useDebouncedValue(search, 250);

  const params = useMemo(
    () => ({
      release: release || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      variable: variable || undefined,
      source: source || undefined,
      level: level || undefined,
      geography: geography || undefined,
      direction: direction || undefined,
      within_tolerance: withinTolerance || undefined,
      search: debouncedSearch || undefined,
      facet: facetParam.length ? facetParam : undefined,
      sort_by: sort.by,
      sort_dir: sort.dir,
    }),
    [
      release,
      variable,
      source,
      level,
      geography,
      direction,
      withinTolerance,
      debouncedSearch,
      facetParam,
      page,
      sort,
    ],
  );

  const { data, isLoading, isFetching, error } = usePopulaceTargetDiagnostics(params);

  const variables = data?.variables ?? [];
  const sources = data?.sources ?? [];
  const levels = data?.levels ?? [];
  const geographies = data?.geographies ?? [];
  const dimensions = data?.dimensions ?? [];
  const variableGroupCount = useMemo(() => groupVariables(variables).length, [variables]);
  const filteredTotal = data?.filtered_total ?? 0;
  const includedTargetCount = data?.summary.included_target_count ?? data?.total_targets ?? null;
  const skippedTargetCount = data?.summary.skipped_target_count ?? null;
  const droppedTargetCount = data?.summary.dropped_target_count ?? null;
  const pageCount = Math.max(Math.ceil(filteredTotal / PAGE_SIZE), 1);
  const activeVariable = variables.find((v) => v.variable_key === variable);
  const columns = useMemo<Column[]>(
    () =>
      activeVariable && dimensions.length
        ? [...dimensionColumns(dimensions), ...METRIC_COLUMNS]
        : [...OVERVIEW_COLUMNS, ...METRIC_COLUMNS],
    [activeVariable, dimensions],
  );

  // "Select the variable and the breakdown, then look at it": when the facets
  // narrow to a single target, open its canonical detail automatically. Keyed on
  // the row identity so closing it (selected -> null) doesn't immediately reopen.
  const singleRow = data?.targets.length === 1 ? data.targets[0] : null;
  const singleKey = singleRow?.name ?? null;
  useEffect(() => {
    if (singleRow) setSelected(singleRow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleKey]);

  function pickVariable(key: string) {
    setVariable(key);
    setFacetFilters({});
    setSelected(null);
    setPage(0);
  }

  function setFacet(key: string, value: string) {
    setFacetFilters((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setSelected(null);
    setPage(0);
  }

  function toggleSort(key: string) {
    setPage(0);
    setSort((current) =>
      current.by === key
        ? { by: key, dir: current.dir === "desc" ? "asc" : "desc" }
        : { by: key, dir: "desc" },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Target diagnostics"
        description="Browse the calibration target surface by the thing each constraint measures — e.g. adjusted gross income, then its by-income-bracket and by-filing-status breakdowns — and see how well the calibrated weights reproduce each."
        actions={
          <ToolbarSelect
            label="Release"
            value={release}
            onChange={pickRelease}
            options={releaseOptions}
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard
          title="Browse by variable"
          description={`${fmt(variableGroupCount, { digits: 0 })} variables in this release. Amount is selected by default when amount/count variants both exist.`}
        >
          <VariableBrowser variables={variables} active={variable} onPick={pickVariable} />
        </SectionCard>

        <div className="flex flex-col gap-5">
          {selected && (
            <PopulaceTargetDetail
              row={selected}
              dimensions={dimensions}
              onClose={() => setSelected(null)}
            />
          )}
          <SectionCard
          title={
            activeVariable ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  {activeVariable.source} / {humanizeName(activeVariable.variable)}
                  {activeVariable.measure ? (
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      ({activeVariable.measure === "total" ? "amount" : activeVariable.measure})
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => pickVariable("")}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-muted/60"
                >
                  clear ✕
                </button>
              </span>
            ) : (
              `Targets (${fmt(filteredTotal, { digits: 0 })} of ${fmt(data?.total_targets ?? null, { digits: 0 })})`
            )
          }
          description={
            activeVariable
              ? `${fmt(activeVariable.n_targets, { digits: 0 })} breakdowns · ${fmt(
                  activeVariable.within_10pct / Math.max(activeVariable.n_targets, 1),
                  { pct: true, digits: 0 },
                )} within 10% · mean abs rel. error ${fmt(activeVariable.mean_abs_relative_error, { pct: true, digits: 1 })}`
              : `${fmt(includedTargetCount, { digits: 0 })} targets included in calibration · ${fmt(droppedTargetCount, { digits: 0 })} dropped before calibration · ${fmt(skippedTargetCount, { digits: 0 })} skipped by calibration. Final estimate is after calibrated weights.`
          }
          padded={false}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                placeholder="Search targets…"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                className="h-8 w-44 rounded-md border border-border bg-white px-3 text-xs focus:border-primary/60 focus:outline-none"
              />
              {activeVariable ? (
                dimensions.map((dim) => (
                  <ToolbarSelect
                    key={dim.key}
                    label={dim.label}
                    value={facetFilters[dim.key] ?? ""}
                    onChange={(value) => setFacet(dim.key, value)}
                    options={[
                      { value: "", label: "Any" },
                      ...dim.values.map((value) => ({
                        value,
                        label: value.replace(/^AGI in /, ""),
                      })),
                    ]}
                  />
                ))
              ) : null}
              <ToolbarSelect
                label="Source"
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setSelected(null);
                  setPage(0);
                }}
                options={[
                  { value: "", label: "Any" },
                  ...sources.map((value) => ({ value, label: value })),
                ]}
              />
              <ToolbarSelect
                label="Level"
                value={level}
                onChange={(value) => {
                  setLevel(value);
                  setSelected(null);
                  setPage(0);
                }}
                options={[
                  { value: "", label: "Any" },
                  ...levels.map((value) => ({ value, label: value })),
                ]}
              />
              <ToolbarSelect
                label="Geography"
                value={geography}
                onChange={(value) => {
                  setGeography(value);
                  setSelected(null);
                  setPage(0);
                }}
                options={[
                  { value: "", label: "Any" },
                  ...geographies.map((value) => ({ value, label: value })),
                ]}
              />
              <ToolbarSelect
                label="Fit"
                value={withinTolerance}
                onChange={(value) => {
                  setWithinTolerance(value);
                  setSelected(null);
                  setPage(0);
                }}
                options={[
                  { value: "", label: "Any" },
                  { value: "true", label: "Within tolerance" },
                  { value: "false", label: "Outside tolerance" },
                ]}
              />
              <ToolbarSelect
                label="Direction"
                value={direction}
                onChange={(value) => {
                  setDirection(value);
                  setSelected(null);
                  setPage(0);
                }}
                options={[
                  { value: "", label: "Any" },
                  { value: "under", label: "Under target" },
                  { value: "over", label: "Over target" },
                  { value: "exact", label: "Exact" },
                ]}
              />
            </div>
          }
          footer={
            <div className="flex items-center justify-between px-5 py-2 text-xs text-muted-foreground">
              <span>
                Page {page + 1} of {pageCount}
                {isFetching && !isLoading ? (
                  <span className="ml-2 text-primary">Updating…</span>
                ) : null}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((current) => Math.max(current - 1, 0))}
                  className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  disabled={!data?.has_next}
                  onClick={() => setPage((current) => current + 1)}
                  className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
                >
                  Next →
                </button>
              </span>
            </div>
          }
        >
          {isLoading ? (
            <LoadingBlock label="Loading target diagnostics…" />
          ) : error || !data ? (
            <EmptyState
              title="Target diagnostics unavailable"
              description={error instanceof Error ? error.message : "Unknown error."}
            />
          ) : data.targets.length === 0 ? (
            <EmptyState title="No targets match the current filters." variant="compact" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    {columns.map((column) => (
                      <th
                        key={column.key}
                        className={`px-3 py-2 font-semibold ${column.numeric ? "text-right" : ""}`}
                      >
                        {column.sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(column.key)}
                            className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
                          >
                            {column.label}
                            {sort.by === column.key ? (sort.dir === "desc" ? "↓" : "↑") : ""}
                          </button>
                        ) : (
                          column.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.targets.map((row) => {
                    const isSelected = selected?.name === row.name;
                    return (
                      <tr
                        key={row.name}
                        onClick={() => setSelected(isSelected ? null : row)}
                        className={`cursor-pointer border-b border-border/60 last:border-b-0 ${
                          isSelected ? "bg-primary/10" : "hover:bg-muted/30"
                        }`}
                      >
                        {columns.map((column) => (
                          <td
                            key={column.key}
                            className={`px-3 py-1.5 tabular-nums ${column.numeric ? "text-right" : ""}`}
                          >
                            {column.render(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
