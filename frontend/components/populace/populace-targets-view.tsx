"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  usePopulaceTargetDiagnostics,
  type PopulaceTargetRow,
} from "@/lib/api/hooks/use-populace";

const PAGE_SIZE = 50;

interface SortState {
  by: string;
  dir: "asc" | "desc";
}

const COLUMNS: {
  key: string;
  label: string;
  numeric?: boolean;
  render: (row: PopulaceTargetRow) => React.ReactNode;
}[] = [
  {
    key: "name",
    label: "Target",
    render: (row) => (
      <span className="block max-w-md truncate" title={String(row.name ?? "")}>
        {row.name}
      </span>
    ),
  },
  {
    key: "family",
    label: "Family",
    render: (row) => <span className="whitespace-nowrap">{row.family}</span>,
  },
  {
    key: "target",
    label: "Target",
    numeric: true,
    render: (row) => fmtCompact(row.target),
  },
  {
    key: "initial_estimate",
    label: "Initial est.",
    numeric: true,
    render: (row) => fmtCompact(row.initial_estimate),
  },
  {
    key: "final_estimate",
    label: "Final est.",
    numeric: true,
    render: (row) => fmtCompact(row.final_estimate),
  },
  {
    key: "relative_error",
    label: "Rel. error",
    numeric: true,
    render: (row) => fmt(row.relative_error, { pct: true, digits: 1 }),
  },
  {
    key: "improvement",
    label: "Improvement",
    numeric: true,
    render: (row) => (
      <span className={(row.improvement ?? 0) > 0 ? "text-emerald-700" : "text-rose-700"}>
        {row.improvement == null ? "—" : fmt(row.improvement, { pct: true, digits: 1 })}
      </span>
    ),
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

export function PopulaceTargetsView() {
  const [family, setFamily] = useState("");
  const [within, setWithin] = useState("");
  const [direction, setDirection] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>({ by: "abs_relative_error", dir: "desc" });

  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      family: family || undefined,
      within_tolerance: within || undefined,
      direction: direction || undefined,
      search: search || undefined,
      sort_by: sort.by,
      sort_dir: sort.dir,
    }),
    [family, within, direction, search, page, sort],
  );

  const { data, isLoading, error } = usePopulaceTargetDiagnostics(params);

  const families = data?.families ?? [];
  const filteredTotal = data?.filtered_total ?? 0;
  const pageCount = Math.max(Math.ceil(filteredTotal / PAGE_SIZE), 1);

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
        description="Per-target calibration fit for the populace-US release: each target's value, the aggregate under the design weights (initial) and the calibrated weights (final), and whether the calibrated estimate lands within tolerance."
        status={
          data?.release_id ? (
            <StatusPill tone="info">{String(data.release_id)}</StatusPill>
          ) : undefined
        }
      />

      <SectionCard
        title={`Targets (${fmt(filteredTotal, { digits: 0 })} of ${fmt(
          data?.total_targets ?? null,
          { digits: 0 },
        )})`}
        description="Click a column header to sort. Relative error is the calibrated estimate's miss against the target; improvement is how much calibration reduced the absolute relative error from the design weights."
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
              className="h-8 w-48 rounded-md border border-border bg-white px-3 text-xs focus:border-primary/60 focus:outline-none"
            />
            <ToolbarSelect
              label="Family"
              value={family}
              onChange={(value) => {
                setFamily(value);
                setPage(0);
              }}
              options={[
                { value: "", label: "All" },
                ...families.map((value) => ({ value, label: value })),
              ]}
            />
            <ToolbarSelect
              label="In tolerance"
              value={within}
              onChange={(value) => {
                setWithin(value);
                setPage(0);
              }}
              options={[
                { value: "", label: "All" },
                { value: "true", label: "Within" },
                { value: "false", label: "Outside" },
              ]}
            />
            <ToolbarSelect
              label="Direction"
              value={direction}
              onChange={(value) => {
                setDirection(value);
                setPage(0);
              }}
              options={[
                { value: "", label: "All" },
                { value: "over", label: "Over target" },
                { value: "under", label: "Under target" },
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
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={`px-3 py-2 font-semibold ${column.numeric ? "text-right" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
                      >
                        {column.label}
                        {sort.by === column.key ? (sort.dir === "desc" ? "↓" : "↑") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.targets.map((row) => (
                  <tr
                    key={row.name}
                    className="border-b border-border/60 last:border-b-0 hover:bg-muted/30"
                  >
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className={`px-3 py-1.5 tabular-nums ${column.numeric ? "text-right" : ""}`}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
