"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
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

const METRIC_COLUMNS: Column[] = [
  {
    key: "target",
    label: "Target",
    numeric: true,
    sortable: true,
    render: (row) => fmtCompact(row.target),
  },
  {
    key: "initial_estimate",
    label: "Initial est.",
    numeric: true,
    sortable: true,
    render: (row) => fmtCompact(row.initial_estimate),
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
    label: "Rel. error",
    numeric: true,
    sortable: true,
    render: (row) => fmt(row.relative_error, { pct: true, digits: 1 }),
  },
  {
    key: "within_tolerance",
    label: "In tol.",
    render: (row) => (
      <StatusPill
        tone={
          row.within_tolerance == null
            ? "neutral"
            : row.within_tolerance
              ? "success"
              : "danger"
        }
      >
        {row.within_tolerance == null ? "—" : row.within_tolerance ? "yes" : "no"}
      </StatusPill>
    ),
  },
];

// Without a variable selected: the "thing" (variable + breakdown) plus source
// and geography. With a variable selected: one column per breakdown dimension.
const OVERVIEW_COLUMNS: Column[] = [
  {
    key: "variable",
    label: "Target",
    sortable: true,
    render: (row) => (
      <div className="max-w-md" title={String(row.name ?? "")}>
        <div className="font-medium text-foreground">{row.variable || row.name}</div>
        {row.breakdown ? (
          <div className="truncate text-xs text-muted-foreground">{row.breakdown}</div>
        ) : null}
      </div>
    ),
  },
  {
    key: "source",
    label: "Source",
    sortable: true,
    render: (row) => <span className="whitespace-nowrap text-muted-foreground">{row.source}</span>,
  },
  {
    key: "geography",
    label: "Geo",
    sortable: true,
    render: (row) => <span className="whitespace-nowrap">{row.geography}</span>,
  },
];

// Resolve a facet key ("geography" | "level" | "dim<N>") against a row.
export function rowFacetValue(
  row: PopulaceTargetRow,
  key: string,
): string | undefined {
  if (key === "geography") return row.geography ?? undefined;
  if (key === "level") return row.level ?? undefined;
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
  const filtered = query
    ? variables.filter((v) => v.variable_key.toLowerCase().includes(query.toLowerCase()))
    : variables;
  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        placeholder="Filter variables…"
        onChange={(event) => setQuery(event.target.value)}
        className="h-8 w-full rounded-md border border-border bg-white px-3 text-xs focus:border-primary/60 focus:outline-none"
      />
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted/40 backdrop-blur">
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-semibold">Variable</th>
              <th className="px-3 py-2 text-right font-semibold">Targets</th>
              <th className="px-3 py-2 text-right font-semibold">Within 10%</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const isActive = v.variable_key === active;
              return (
                <tr
                  key={v.variable_key}
                  onClick={() => onPick(isActive ? "" : v.variable_key)}
                  className={`cursor-pointer border-t border-border/60 ${
                    isActive ? "bg-primary/10" : "hover:bg-muted/40"
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <span className={isActive ? "font-medium text-primary" : ""}>
                      {v.variable || v.variable_key}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">{v.source}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(v.n_targets, { digits: 0 })}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {v.n_targets
                      ? fmt(v.within_10pct / v.n_targets, { pct: true, digits: 0 })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PopulaceTargetsView() {
  const [release, setRelease] = useState("");
  const [variable, setVariable] = useState("");
  const [source, setSource] = useState("");
  const [level, setLevel] = useState("");
  const [within, setWithin] = useState("");
  const [direction, setDirection] = useState("");
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
        label: r.release_id.replace(/^populace-us-\d{4}-/, "").replace(/-c[0-9a-f]{12}-/, "·"),
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

  const params = useMemo(
    () => ({
      release: release || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      variable: variable || undefined,
      source: source || undefined,
      level: level || undefined,
      within_tolerance: within || undefined,
      direction: direction || undefined,
      search: search || undefined,
      facet: facetParam.length ? facetParam : undefined,
      sort_by: sort.by,
      sort_dir: sort.dir,
    }),
    [release, variable, source, level, within, direction, search, facetParam, page, sort],
  );

  const { data, isLoading, error } = usePopulaceTargetDiagnostics(params);

  const variables = data?.variables ?? [];
  const sources = data?.sources ?? [];
  const dimensions = data?.dimensions ?? [];
  const filteredTotal = data?.filtered_total ?? 0;
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
        status={
          data?.release_id ? (
            <StatusPill tone="info">
              {String(data.release_id)} · {fmt(data.total_targets, { digits: 0 })} targets
            </StatusPill>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <SectionCard
          title="Browse by variable"
          description={`${fmt(variables.length, { digits: 0 })} measured quantities in this release. Click one to filter the table.`}
        >
          <div className="mb-3 flex flex-col gap-1">
            <ToolbarSelect
              label="Release"
              value={release}
              onChange={pickRelease}
              options={releaseOptions}
              className="w-full"
            />
            <span className="text-[11px] text-muted-foreground">
              The newest build can be a small surface; switch release to see others.
            </span>
          </div>
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
                <span>{activeVariable.variable_key}</span>
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
              : "Relative error is the calibrated estimate's miss against the target. Click a column header to sort."
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
              ) : (
                <>
                  <ToolbarSelect
                    label="Source"
                    value={source}
                    onChange={(value) => {
                      setSource(value);
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
                      setPage(0);
                    }}
                    options={[
                      { value: "", label: "Any" },
                      { value: "national", label: "National" },
                      { value: "state", label: "State" },
                    ]}
                  />
                </>
              )}
              <ToolbarSelect
                label="In tol."
                value={within}
                onChange={(value) => {
                  setWithin(value);
                  setPage(0);
                }}
                options={[
                  { value: "", label: "Any" },
                  { value: "true", label: "Within" },
                  { value: "false", label: "Outside" },
                ]}
              />
            </div>
          }
          footer={
            <div className="flex items-center justify-between px-5 py-2 text-xs text-muted-foreground">
              <span>
                Page {page + 1} of {pageCount}
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
