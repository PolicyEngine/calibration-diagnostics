"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fmt, fmtCompact, fmtMoney, humanizeName } from "@/components/shared/format";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import { fitColor } from "@/lib/treemap/fit-scale";
import {
  usePopulaceTargetDiagnostics,
  type PopulaceTargetRow,
  type PopulaceTreemapGroup,
  type PopulaceTreemapLeaf,
} from "@/lib/api/hooks/use-populace";

function isSynthetic(key: string): boolean {
  return key.startsWith("__other");
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function valueFmt(row: PopulaceTargetRow, value: number | null | undefined): string {
  return row.ledger?.measure_unit?.toLowerCase() === "usd"
    ? fmtMoney(value)
    : fmtCompact(value);
}

function cleanValue(value: string): string {
  return value.replace(/^AGI in /, "");
}

function rowBreakdown(row: PopulaceTargetRow): string {
  const dims =
    row.target_dimensions
      ?.map((d) => d.value)
      .filter((v) => v && v !== "All" && v !== "Total") ?? [];
  const geo =
    row.geography && row.geography !== "United States" ? row.geography : null;
  const parts = [geo, ...dims].filter(Boolean).map((p) => cleanValue(String(p)));
  if (parts.length) return parts.join(" · ");
  if (row.breakdown && row.breakdown !== "Total") return row.breakdown;
  return "Overall";
}

function errorText(row: PopulaceTargetRow): string {
  if (row.error_kind === "absolute") return valueFmt(row, row.final_error);
  return fmt(row.final_error, { pct: true, digits: 1 });
}

export function ClusterDetail({
  leaf,
  group,
  release,
  level,
  onClose,
}: {
  leaf: PopulaceTreemapLeaf;
  group: PopulaceTreemapGroup;
  release?: string;
  // Geography level the parent map is filtered to; scopes the target list so
  // it matches the tile's counts.
  level?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const synthetic = isSynthetic(leaf.key);

  const [facets, setFacets] = useState<Record<string, string>>({});
  const [fit, setFit] = useState("");
  const [direction, setDirection] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({
    by: "abs_relative_error",
    dir: "asc",
  });
  const debouncedSearch = useDebounced(search, 250);

  const facetParam = useMemo(
    () =>
      Object.entries(facets)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}:${v}`),
    [facets],
  );

  const { data, isLoading } = usePopulaceTargetDiagnostics({
    release,
    variable: synthetic ? undefined : leaf.key,
    source: synthetic ? leaf.source : undefined,
    level: level || undefined,
    facet: facetParam.length ? facetParam : undefined,
    within_tolerance: fit || undefined,
    direction: direction || undefined,
    search: debouncedSearch || undefined,
    limit: 150,
    sort_by: sort.by,
    sort_dir: sort.dir,
  });

  function toggleSort(key: string) {
    setSort((current) =>
      current.by === key
        ? { by: key, dir: current.dir === "desc" ? "asc" : "desc" }
        : { by: key, dir: "desc" },
    );
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = data?.targets ?? [];
  // Only show dimensions that actually subdivide this cluster. Many carry just
  // placeholder "All"/"Total" values (e.g. EITC's income band), which make for
  // an empty, misleading filter.
  const dimensions = (data?.dimensions ?? [])
    .map((d) => ({
      ...d,
      values: d.values.filter((v) => v && v !== "All" && v !== "Total"),
    }))
    .filter((d) => d.values.length > 0);
  const filteredTotal = data?.filtered_total ?? rows.length;
  const within = leaf.scored > 0 ? leaf.within_10pct / leaf.scored : null;
  const name = synthetic ? leaf.variable : humanizeName(leaf.variable) || leaf.variable;
  const hasFilters = facetParam.length > 0 || fit !== "" || direction !== "" || search !== "";

  function setFacet(key: string, value: string) {
    setFacets((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  function clearFilters() {
    setFacets({});
    setFit("");
    setDirection("");
    setSearch("");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl ring-1 ring-border/60">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-border"
            style={{ background: fitColor(leaf.median_abs_relative_error) }}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-foreground">{name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {group.label}
              {!synthetic && leaf.measure
                ? ` · ${leaf.measure === "total" ? "amount" : leaf.measure}`
                : ""}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <dl className="hidden items-center gap-4 sm:flex">
            <Mini label="Targets" value={fmt(leaf.n_targets, { digits: 0 })} />
            <Mini
              label="Within 10%"
              value={within == null ? "—" : fmt(within, { pct: true, digits: 0 })}
            />
            <Mini
              label="Median error"
              value={fmt(leaf.median_abs_relative_error, { pct: true, digits: 1 })}
            />
          </dl>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cluster details"
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-end gap-2 border-b border-border bg-card px-4 py-2.5">
        <label className="grid min-w-0 gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Search</span>
          <input
            type="search"
            value={search}
            placeholder="Filter breakdowns…"
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-44 rounded-md border border-border bg-card px-2.5 text-sm focus:border-primary/60 focus:outline-none"
          />
        </label>
        {dimensions.map((dim) => (
          <ToolbarSelect
            key={dim.key}
            label={dim.label}
            value={facets[dim.key] ?? ""}
            onChange={(v) => setFacet(dim.key, v)}
            options={[
              { value: "", label: "Any" },
              ...dim.values.map((v) => ({ value: v, label: cleanValue(v) })),
            ]}
            layout="stacked"
          />
        ))}
        <ToolbarSelect
          label="Fit"
          value={fit}
          onChange={setFit}
          options={[
            { value: "", label: "Any" },
            { value: "true", label: "Within 10%" },
            { value: "false", label: "Outside 10%" },
          ]}
          layout="stacked"
        />
        <ToolbarSelect
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "", label: "Any" },
            { value: "under", label: "Under target" },
            { value: "over", label: "Over target" },
            { value: "exact", label: "Exact" },
          ]}
          layout="stacked"
        />
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-8 self-end rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading targets…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No targets match these filters.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-card shadow-[var(--elev-1)]">
              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-semibold">Breakdown</th>
                <SortHeader label="Target" sortKey="target" sort={sort} onSort={toggleSort} />
                <SortHeader
                  label="Final estimate"
                  sortKey="final_estimate"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortHeader
                  label="Error"
                  sortKey="abs_relative_error"
                  sort={sort}
                  onSort={toggleSort}
                />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.name}
                  className="border-b border-border/50 last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: fitColor(row.abs_relative_error) }}
                      />
                      <span className="truncate">{rowBreakdown(row)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums">
                    {valueFmt(row, row.target)}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono tabular-nums">
                    {valueFmt(row, row.final_estimate)}
                  </td>
                  <td
                    className={`px-4 py-1.5 text-right font-mono tabular-nums ${
                      (row.abs_relative_error ?? 0) > 0.1 ? "tone-neg" : "text-foreground"
                    }`}
                  >
                    {errorText(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center justify-between border-t border-border bg-muted/10 px-4 py-2 text-xs text-muted-foreground">
        <span>
          {fmt(Math.min(rows.length, filteredTotal), { digits: 0 })} of{" "}
          {fmt(filteredTotal, { digits: 0 })}
          {hasFilters ? " matching" : ""} targets ·{" "}
          {sort.by === "abs_relative_error"
            ? sort.dir === "desc"
              ? "worst fit first"
              : "best fit first"
            : `sorted by ${sort.by === "final_estimate" ? "estimate" : sort.by}`}
        </span>
        <button
          type="button"
          onClick={() =>
            router.push(
              synthetic && leaf.source === "__other_sources__"
                ? "/populace/targets"
                : `/populace/targets?source=${encodeURIComponent(leaf.source)}${
                    level ? `&level=${encodeURIComponent(level)}` : ""
                  }`,
            )
          }
          className="font-medium text-primary hover:underline"
        >
          Open in full diagnostics ↗
        </button>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  sort: { by: string; dir: "asc" | "desc" };
  onSort: (key: string) => void;
}) {
  const active = sort.by === sortKey;
  return (
    <th className="px-4 py-2 text-right font-semibold">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (sort.dir === "desc" ? "↓" : "↑") : "↕"}</span>
      </button>
    </th>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </dt>
      <dd className="font-mono text-sm font-semibold leading-none text-foreground">{value}</dd>
    </div>
  );
}
