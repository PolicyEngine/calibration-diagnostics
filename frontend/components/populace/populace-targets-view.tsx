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
  type PopulaceTargetDiagnosticRow,
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
  render: (row: PopulaceTargetDiagnosticRow) => React.ReactNode;
}[] = [
  {
    key: "target_name",
    label: "Target",
    render: (row) => (
      <span className="block max-w-md truncate" title={String(row.target_name ?? "")}>
        {row.target_name}
      </span>
    ),
  },
  {
    key: "family",
    label: "Family",
    render: (row) => <span className="whitespace-nowrap">{row.family}</span>,
  },
  {
    key: "split",
    label: "Split",
    render: (row) => row.split,
  },
  {
    key: "target_value",
    label: "Target value",
    numeric: true,
    render: (row) => fmtCompact(row.target_value),
  },
  {
    key: "candidate_estimate",
    label: "Populace est.",
    numeric: true,
    render: (row) => fmtCompact(row.candidate_estimate),
  },
  {
    key: "candidate_relative_error",
    label: "Populace rel. err",
    numeric: true,
    render: (row) => fmt(row.candidate_relative_error, { pct: true, digits: 1 }),
  },
  {
    key: "baseline_relative_error",
    label: "eCPS rel. err",
    numeric: true,
    render: (row) => fmt(row.baseline_relative_error, { pct: true, digits: 1 }),
  },
  {
    key: "loss_delta",
    label: "Loss delta",
    numeric: true,
    render: (row) => (
      <span className={(row.loss_delta ?? 0) < 0 ? "text-emerald-700" : "text-rose-700"}>
        {row.loss_delta == null ? "—" : row.loss_delta.toExponential(2)}
      </span>
    ),
  },
  {
    key: "winner",
    label: "Closer",
    render: (row) => (
      <StatusPill
        tone={
          row.winner === "candidate"
            ? "success"
            : row.winner === "baseline"
              ? "danger"
              : "neutral"
        }
      >
        {row.winner === "candidate"
          ? "populace"
          : row.winner === "baseline"
            ? "eCPS"
            : "tie"}
      </StatusPill>
    ),
  },
];

export function PopulaceTargetsView() {
  const [family, setFamily] = useState("");
  const [split, setSplit] = useState("");
  const [winner, setWinner] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>({
    by: "candidate_loss_term",
    dir: "desc",
  });

  const params = useMemo(
    () => ({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      family: family || undefined,
      split: split || undefined,
      winner: winner || undefined,
      search: search || undefined,
      sort_by: sort.by,
      sort_dir: sort.dir,
    }),
    [family, split, winner, search, page, sort],
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
        description="Per-target fit for the populace-US release versus the enhanced CPS, from the published sound_ecps_replacement_comparison artifact. Candidate is populace; baseline is the enhanced CPS."
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
        description="Click a column header to sort. Loss terms use the calibrator's relative-error loss; negative loss delta means populace fits the target better."
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
              label="Split"
              value={split}
              onChange={(value) => {
                setSplit(value);
                setPage(0);
              }}
              options={[
                { value: "", label: "All" },
                { value: "train", label: "Train" },
                { value: "holdout", label: "Holdout" },
              ]}
            />
            <ToolbarSelect
              label="Closer"
              value={winner}
              onChange={(value) => {
                setWinner(value);
                setPage(0);
              }}
              options={[
                { value: "", label: "All" },
                { value: "candidate", label: "Populace" },
                { value: "baseline", label: "Enhanced CPS" },
                { value: "tie", label: "Tie" },
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
                    key={`${row.target_name}-${row.target_index}`}
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
