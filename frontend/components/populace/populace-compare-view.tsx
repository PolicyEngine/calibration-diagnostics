"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, fmtSigned, humanizeName, releaseLabel } from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  usePopulaceCompare,
  usePopulaceReleases,
  type PopulaceComparisonRow,
} from "@/lib/api/hooks/use-populace";

const MAX_MOVER_REL_ERROR = 10; // Keep the compare summary to bounded relative errors (<= 1000%).
const TARGET_COMPARE_PAGE_SIZE = 100;

type CompareScope = "all" | "healthcare";

interface CompareSortState {
  by: string;
  dir: "asc" | "desc";
}

function relErr(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { pct: true, digits: 1 });
}

type LossKind = "normalized_target_loss" | "raw_optimizer_objective";

function isNormalizedLoss(kind: LossKind | undefined): boolean {
  return kind === "normalized_target_loss";
}

function fmtLoss(value: number | null | undefined, kind?: LossKind): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (isNormalizedLoss(kind)) return fmt(value, { digits: value < 1 ? 4 : 3 });
  return value.toExponential(3).replace("e+", "e");
}

function lossKindLabel(kind: LossKind | undefined): string {
  return isNormalizedLoss(kind) ? "normalized" : "raw";
}

function relativeChange(
  from: number | null | undefined,
  to: number | null | undefined,
): number | null {
  if (
    from == null ||
    to == null ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from === 0
  ) {
    return null;
  }
  return (to - from) / Math.abs(from);
}

function errorValue(row: PopulaceComparisonRow, side: "a" | "b") {
  const value = side === "a" ? row.a_error : row.b_error;
  if (row.error_kind === "absolute") return fmtCompact(value);
  return relErr(value);
}

function targetLabel(row: PopulaceComparisonRow) {
  return row.target_label || row.breakdown || row.geography || row.name;
}

function measureLabel(measure: string | null | undefined): string {
  if (!measure || measure === "total") return "amount";
  if (measure === "count") return "count";
  return humanizeName(measure).toLowerCase();
}

function fmtPointDelta(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value * 100).toFixed(1)} pp`;
}

interface HealthcareSummarySpec {
  key: string;
  label: string;
  matches: (row: PopulaceComparisonRow) => boolean;
}

interface HealthcareComparisonSummary {
  key: string;
  label: string;
  commonTargets: number;
  aMeanAbsError: number | null;
  bMeanAbsError: number | null;
  fitChange: number | null;
}

function healthcareRowText(row: PopulaceComparisonRow): string {
  return [
    row.name,
    row.source,
    row.target_role,
    row.source_measure_id,
    row.variable_key,
    row.variable,
    row.measure,
    row.breakdown,
    row.target_label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function rowHasAny(row: PopulaceComparisonRow, terms: string[]): boolean {
  const text = healthcareRowText(row);
  return terms.some((term) => text.includes(term));
}

function isMedicaidEnrollmentRow(row: PopulaceComparisonRow): boolean {
  return (
    row.target_role === "medicaid_enrollment" ||
    rowHasAny(row, ["total_medicaid_enrollment", "medicaid enrollment"])
  );
}

function isMedicaidChipEnrollmentRow(row: PopulaceComparisonRow): boolean {
  return (
    row.target_role === "medicaid_chip_enrollment" ||
    rowHasAny(row, ["medicaid_chip", "medicaid chip", "medicaid + chip"])
  );
}

const HEALTHCARE_SUMMARY_SPECS: HealthcareSummarySpec[] = [
  {
    key: "aca_marketplace",
    label: "ACA marketplace",
    matches: (row) => row.source === "cms_aca" || rowHasAny(row, ["cms_aca", "aca marketplace"]),
  },
  {
    key: "aptc_recipients",
    label: "APTC recipients",
    matches: (row) =>
      row.target_role === "aca_ptc_recipients" ||
      rowHasAny(row, ["aptc_recipients", "aptc recipients", "premium tax credit recipients"]),
  },
  {
    key: "medicaid",
    label: "Medicaid",
    matches: isMedicaidEnrollmentRow,
  },
  {
    key: "medicaid_chip",
    label: "Medicaid + CHIP",
    matches: isMedicaidChipEnrollmentRow,
  },
  {
    key: "medicare_part_b",
    label: "Medicare Part B",
    matches: (row) =>
      row.target_role === "medicare_part_b_premium_total" ||
      rowHasAny(row, ["part_b", "part b", "medicare_part_b"]),
  },
];

function comparisonPairKey(row: PopulaceComparisonRow): string {
  const dimensions =
    row.target_dimensions
      ?.filter((dim) => !dim.label.toLowerCase().includes("measure"))
      .map((dim) => `${dim.label}:${dim.value}`) ?? [];
  return [row.level ?? "", row.geography ?? "", ...dimensions].join("||");
}

function relativeErrorFromEstimate(
  estimate: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (
    estimate == null ||
    target == null ||
    !Number.isFinite(estimate) ||
    !Number.isFinite(target) ||
    target === 0
  ) {
    return null;
  }
  return (estimate - target) / Math.abs(target);
}

function meanAbs(values: (number | null)[]): number | null {
  const finite = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map(Math.abs);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function meanAbsError(rows: PopulaceComparisonRow[], side: "a" | "b"): number | null {
  const values = rows
    .filter((row) => row.error_kind === "relative")
    .map((row) => (side === "a" ? row.a_error : row.b_error))
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map(Math.abs);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function healthcareSummaries(rows: PopulaceComparisonRow[]): HealthcareComparisonSummary[] {
  const direct = HEALTHCARE_SUMMARY_SPECS.map((spec) => {
    const matches = rows.filter(spec.matches);
    const aMeanAbsError = meanAbsError(matches, "a");
    const bMeanAbsError = meanAbsError(matches, "b");
    return {
      key: spec.key,
      label: spec.label,
      commonTargets: matches.length,
      aMeanAbsError,
      bMeanAbsError,
      fitChange:
        aMeanAbsError == null || bMeanAbsError == null
          ? null
          : bMeanAbsError - aMeanAbsError,
    };
  });
  direct.splice(4, 0, impliedChipSummary(rows));
  return direct;
}

function impliedChipSummary(rows: PopulaceComparisonRow[]): HealthcareComparisonSummary {
  const medicaidByKey = new Map(
    rows.filter(isMedicaidEnrollmentRow).map((row) => [comparisonPairKey(row), row]),
  );
  const aErrors: (number | null)[] = [];
  const bErrors: (number | null)[] = [];
  let commonTargets = 0;

  for (const combined of rows.filter(isMedicaidChipEnrollmentRow)) {
    const medicaid = medicaidByKey.get(comparisonPairKey(combined));
    if (!medicaid) continue;
    commonTargets += 1;
    const aTarget =
      combined.a_target == null || medicaid.a_target == null
        ? null
        : combined.a_target - medicaid.a_target;
    const bTarget =
      combined.b_target == null || medicaid.b_target == null
        ? null
        : combined.b_target - medicaid.b_target;
    const aEstimate =
      combined.a_final_estimate == null || medicaid.a_final_estimate == null
        ? null
        : combined.a_final_estimate - medicaid.a_final_estimate;
    const bEstimate =
      combined.b_final_estimate == null || medicaid.b_final_estimate == null
        ? null
        : combined.b_final_estimate - medicaid.b_final_estimate;
    aErrors.push(relativeErrorFromEstimate(aEstimate, aTarget));
    bErrors.push(relativeErrorFromEstimate(bEstimate, bTarget));
  }

  const aMeanAbsError = meanAbs(aErrors);
  const bMeanAbsError = meanAbs(bErrors);
  return {
    key: "chip_implied",
    label: "CHIP implied",
    commonTargets,
    aMeanAbsError,
    bMeanAbsError,
    fitChange:
      aMeanAbsError == null || bMeanAbsError == null
        ? null
        : bMeanAbsError - aMeanAbsError,
  };
}

function summaryTone(value: number | null): "positive" | "negative" | "neutral" {
  if (value == null || Math.abs(value) <= 1e-9) return "neutral";
  return value < 0 ? "positive" : "negative";
}

function comparisonDimensionLabel(row: PopulaceComparisonRow): string {
  const parts =
    row.breakdown
      ?.split(" · ")
      .map((part) => part.trim())
      .filter((part) => part && part !== "All" && part !== "Total") ?? [];
  return parts.length ? parts.join(" · ") : "overall";
}

function targetSearchText(row: PopulaceComparisonRow) {
  return [
    row.name,
    row.source,
    row.variable_key,
    row.variable,
    row.measure,
    row.level,
    row.geography,
    row.breakdown,
    row.target_label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b));
}

function dimensionValue(row: PopulaceComparisonRow, label: string): string | null {
  const dim = row.target_dimensions?.find((entry) => entry.label === label);
  if (dim?.value) return dim.value;
  return null;
}

function dimensionFilters(rows: PopulaceComparisonRow[]) {
  const byLabel = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const dim of row.target_dimensions ?? []) {
      if (!dim.label || !dim.value || dim.value === "All") continue;
      const values = byLabel.get(dim.label) ?? new Set<string>();
      values.add(dim.value);
      byLabel.set(dim.label, values);
    }
  }
  return [...byLabel.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([label, values]) => ({
      label,
      values: [...values].sort((a, b) => {
        if (a === "Total") return -1;
        if (b === "Total") return 1;
        return a.localeCompare(b, undefined, { numeric: true });
      }),
    }))
    .sort((a, b) => b.values.length - a.values.length || a.label.localeCompare(b.label));
}

function compareSortValue(row: PopulaceComparisonRow, key: string): string | number | null {
  switch (key) {
    case "source":
      return row.source ?? null;
    case "measure":
      return row.variable ?? row.variable_key ?? null;
    case "geography":
      return row.geography ?? null;
    case "breakdown":
      return row.breakdown ?? row.target_label ?? null;
    case "target":
      return row.b_target ?? row.a_target ?? null;
    case "a_final":
      return row.a_final_estimate ?? null;
    case "b_final":
      return row.b_final_estimate ?? null;
    case "a_error":
      return row.a_error == null ? null : Math.abs(row.a_error);
    case "b_error":
      return row.b_error == null ? null : Math.abs(row.b_error);
    case "abs_rel_delta":
      return row.abs_rel_delta ?? null;
    default:
      return null;
  }
}

function comparisonTargetValue(row: PopulaceComparisonRow) {
  if (row.a_target != null && row.b_target != null && row.a_target !== row.b_target) {
    return `${fmtCompact(row.a_target)} → ${fmtCompact(row.b_target)}`;
  }
  return fmtCompact(row.b_target ?? row.a_target);
}

function formatCompareValue(value: number | null | undefined): string {
  return fmtCompact(value);
}

function isBoundedRelativeMover(row: PopulaceComparisonRow) {
  return (
    row.error_kind === "relative" &&
    row.abs_rel_delta != null &&
    row.a_error != null &&
    row.b_error != null &&
    Math.abs(row.a_error) <= MAX_MOVER_REL_ERROR &&
    Math.abs(row.b_error) <= MAX_MOVER_REL_ERROR
  );
}

function CompareChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-rose-700"
        : "text-foreground";
  return (
    <div className="grid min-w-0 gap-0.5 rounded border border-border bg-white px-2 py-1">
      <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`truncate font-mono text-xs font-semibold tabular-nums ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

function ScopeSegmentedControl({
  scope,
  onChange,
}: {
  scope: CompareScope;
  onChange: (scope: CompareScope) => void;
}) {
  const options: { value: CompareScope; label: string }[] = [
    { value: "all", label: "All targets" },
    { value: "healthcare", label: "Healthcare" },
  ];
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">Scope</span>
      <span className="inline-flex h-9 overflow-hidden rounded-md border border-border bg-white">
        {options.map((option) => {
          const active = scope === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`px-3 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}

function MoverList({ rows }: { rows: PopulaceComparisonRow[] }) {
  if (!rows.length) return <EmptyState title="No common targets to compare." variant="compact" />;
  return (
    <div className="divide-y divide-border/60 rounded-md border border-border">
      {rows.map((row) => {
        const improved = (row.abs_rel_delta ?? 0) < 0;
        return (
          <div
            key={row.name}
            className="grid gap-2 px-3 py-2.5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center"
          >
            <div className="min-w-0 pr-2">
              <div className="truncate text-sm font-medium text-foreground" title={row.name}>
                {targetLabel(row)}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                <span>{row.source || "source"}</span>
                <span>·</span>
                <span>{measureLabel(row.measure)}</span>
                <span>·</span>
                <span className="truncate">{comparisonDimensionLabel(row)}</span>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-4 gap-1.5 xl:w-[24rem]">
              <CompareChip label="Target" value={comparisonTargetValue(row)} />
              <CompareChip label="A final" value={formatCompareValue(row.a_final_estimate)} />
              <CompareChip label="B final" value={formatCompareValue(row.b_final_estimate)} />
              <CompareChip
                label="Fit change"
                value={fmtPointDelta(row.abs_rel_delta)}
                tone={improved ? "positive" : "negative"}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TargetComparisonTable({ rows }: { rows: PopulaceComparisonRow[] }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [measure, setMeasure] = useState("");
  const [geography, setGeography] = useState("");
  const [fit, setFit] = useState("");
  const [direction, setDirection] = useState("");
  const [facets, setFacets] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<CompareSortState>({ by: "abs_rel_delta", dir: "asc" });
  const [page, setPage] = useState(0);
  const sources = useMemo(() => uniqueSorted(rows.map((row) => row.source)), [rows]);
  const measures = useMemo(
    () => uniqueSorted(rows.map((row) => row.variable ?? row.variable_key)),
    [rows],
  );
  const geographies = useMemo(() => uniqueSorted(rows.map((row) => row.geography)), [rows]);
  const dimensions = useMemo(() => dimensionFilters(rows), [rows]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = rows.filter((row) => {
      if (needle && !targetSearchText(row).includes(needle)) return false;
      if (source && row.source !== source) return false;
      if (measure && (row.variable ?? row.variable_key) !== measure) return false;
      if (geography && row.geography !== geography) return false;
      if (fit === "improved" && !((row.abs_rel_delta ?? 0) < 0)) return false;
      if (fit === "regressed" && !((row.abs_rel_delta ?? 0) > 0)) return false;
      if (fit === "unchanged" && Math.abs(row.abs_rel_delta ?? Infinity) > 1e-9) return false;
      if (direction === "under" && !((row.b_error ?? 0) < 0)) return false;
      if (direction === "over" && !((row.b_error ?? 0) > 0)) return false;
      if (direction === "exact" && Math.abs(row.b_error ?? Infinity) > 1e-9) return false;
      return Object.entries(facets).every(
        ([label, value]) => !value || dimensionValue(row, label) === value,
      );
    });
    return [...result].sort((aRow, bRow) => {
      const aValue = compareSortValue(aRow, sort.by);
      const bValue = compareSortValue(bRow, sort.by);
      const directionMultiplier = sort.dir === "asc" ? 1 : -1;
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * directionMultiplier;
      }
      return String(aValue).localeCompare(String(bValue)) * directionMultiplier;
    });
  }, [rows, query, source, measure, geography, fit, direction, facets, sort]);
  const pageCount = Math.max(Math.ceil(filtered.length / TARGET_COMPARE_PAGE_SIZE), 1);
  const pageRows = filtered.slice(
    page * TARGET_COMPARE_PAGE_SIZE,
    page * TARGET_COMPARE_PAGE_SIZE + TARGET_COMPARE_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [query, rows, source, measure, geography, fit, direction, facets, sort]);

  function setFacet(label: string, value: string) {
    setFacets((current) => {
      const next = { ...current };
      if (value) next[label] = value;
      else delete next[label];
      return next;
    });
  }

  function toggleSort(key: string) {
    setSort((current) =>
      current.by === key
        ? { by: key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { by: key, dir: key === "abs_rel_delta" ? "asc" : "desc" },
    );
  }

  function sortableHeader(key: string, label: string, align: "left" | "right" = "left") {
    return (
      <th className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : ""}`}>
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground ${
            align === "right" ? "justify-end" : ""
          }`}
        >
          {label}
          {sort.by === key ? (sort.dir === "desc" ? "↓" : "↑") : ""}
        </button>
      </th>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        <label className="grid min-w-0 gap-1">
          <span className="truncate text-xs font-medium text-muted-foreground">Search</span>
          <input
            type="search"
            value={query}
            placeholder="Search targets or variables…"
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full rounded-md border border-border bg-white px-3 text-sm focus:border-primary/60 focus:outline-none"
          />
        </label>
        <ToolbarSelect
          label="Source"
          value={source}
          onChange={setSource}
          options={[{ value: "", label: "Any" }, ...sources.map((value) => ({ value, label: value }))]}
          layout="stacked"
          className="w-full"
        />
        <ToolbarSelect
          label="Measure"
          value={measure}
          onChange={setMeasure}
          options={[{ value: "", label: "Any" }, ...measures.map((value) => ({ value, label: humanizeName(value) }))]}
          layout="stacked"
          className="w-full"
        />
        <ToolbarSelect
          label="Geography"
          value={geography}
          onChange={setGeography}
          options={[{ value: "", label: "Any" }, ...geographies.map((value) => ({ value, label: value }))]}
          layout="stacked"
          className="w-full"
        />
        <ToolbarSelect
          label="Fit"
          value={fit}
          onChange={setFit}
          options={[
            { value: "", label: "Any" },
            { value: "improved", label: "Improved" },
            { value: "regressed", label: "Regressed" },
            { value: "unchanged", label: "Unchanged" },
          ]}
          layout="stacked"
          className="w-full"
        />
        <ToolbarSelect
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "", label: "Any" },
            { value: "under", label: "B under target" },
            { value: "over", label: "B over target" },
            { value: "exact", label: "B exact" },
          ]}
          layout="stacked"
          className="w-full"
        />
        {dimensions.map((dim) => (
          <ToolbarSelect
            key={dim.label}
            label={dim.label}
            value={facets[dim.label] ?? ""}
            onChange={(value) => setFacet(dim.label, value)}
            options={[
              { value: "", label: "Any" },
              ...dim.values.map((value) => ({ value, label: value.replace(/^AGI in /, "") })),
            ]}
            layout="stacked"
            className="w-full"
          />
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        {fmt(filtered.length, { digits: 0 })} of {fmt(rows.length, { digits: 0 })} common targets
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
              {sortableHeader("source", "Source")}
              {sortableHeader("measure", "Measure")}
              {sortableHeader("geography", "Geography")}
              {sortableHeader("breakdown", "Dimensions")}
              {sortableHeader("target", "Target", "right")}
              {sortableHeader("a_final", "A est.", "right")}
              {sortableHeader("b_final", "B est.", "right")}
              {sortableHeader("a_error", "A err", "right")}
              {sortableHeader("b_error", "B err", "right")}
              {sortableHeader("abs_rel_delta", "|err| change", "right")}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No common target rows were returned for these releases."
                    : "No targets match the current search."}
                </td>
              </tr>
            ) : pageRows.map((row) => {
              const improved = (row.abs_rel_delta ?? 0) < 0;
              const regressed = (row.abs_rel_delta ?? 0) > 0;
              return (
                <tr key={row.name} className="border-b border-border/60 last:border-b-0">
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-foreground">{row.source || "—"}</div>
                    <div className="text-xs text-muted-foreground">{row.level || "—"}</div>
                  </td>
                  <td className="max-w-sm px-3 py-1.5" title={row.variable_key ?? row.name}>
                    <div className="font-medium text-foreground">
                      {row.variable ? humanizeName(row.variable) : row.variable_key || "—"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {measureLabel(row.measure)}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="whitespace-nowrap">{row.geography || "—"}</span>
                  </td>
                  <td className="max-w-md px-3 py-1.5" title={row.name}>
                    <div className="truncate">{row.breakdown || row.target_label || "All"}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {comparisonTargetValue(row)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmtCompact(row.a_final_estimate)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmtCompact(row.b_final_estimate)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {errorValue(row, "a")}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {errorValue(row, "b")}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      improved ? "text-emerald-700" : regressed ? "text-rose-700" : ""
                    }`}
                  >
                    {fmtPointDelta(row.abs_rel_delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Page {page + 1} of {pageCount}</span>
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
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((current) => Math.min(current + 1, pageCount - 1))}
            className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
          >
            Next →
          </button>
        </span>
      </div>
    </div>
  );
}

function LossRow({
  label,
  initial,
  final,
  lossKind,
}: {
  label: string;
  initial: number | null | undefined;
  final: number | null | undefined;
  lossKind: LossKind;
}) {
  const reduction = relativeChange(initial, final);
  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <td className="px-3 py-2 font-medium">{label}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtLoss(initial, lossKind)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtLoss(final, lossKind)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {reduction == null ? "—" : fmt(-reduction, { pct: true, digits: 3 })}
      </td>
    </tr>
  );
}

export function PopulaceCompareView({
  initialA = "",
  initialB = "",
  initialScope = "all",
}: {
  initialA?: string;
  initialB?: string;
  initialScope?: CompareScope;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: releaseData, isLoading: releasesLoading } = usePopulaceReleases();
  const releases = releaseData?.releases ?? [];

  const [scope, setScope] = useState<CompareScope>(initialScope);
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);

  // Default B to the latest release and A to the next one down.
  useEffect(() => {
    if (!releases.length) return;
    if (!b) setB(releaseData?.latest_release_id || releases[0].release_id);
    if (!a && releases[1]) setA(releases[1].release_id);
  }, [releases, releaseData, a, b]);

  useEffect(() => {
    if (!a || !b) return;
    const params = new URLSearchParams();
    if (scope === "healthcare") params.set("scope", scope);
    params.set("a", a);
    params.set("b", b);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [a, b, pathname, router, scope]);

  const { data, isLoading, error } = usePopulaceCompare(a, b, scope);

  const options = useMemo(
    () => releases.map((r) => ({ value: r.release_id, label: releaseLabel(r.release_id, r.date) })),
    [releases],
  );
  const dateOf = (id: string) => {
    const r = releases.find((x) => x.release_id === id);
    return r ? releaseLabel(r.release_id, r.date) : id;
  };

  const improvements = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => isBoundedRelativeMover(r) && (r.abs_rel_delta ?? 0) < 0)
        .slice(0, 10),
    [data],
  );
  const regressions = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => isBoundedRelativeMover(r) && (r.abs_rel_delta ?? 0) > 0)
        .slice(0, 10),
    [data],
  );
  const healthcareProgramSummaries = useMemo(
    () => healthcareSummaries(data?.rows ?? []),
    [data],
  );
  const lossDelta =
    data?.a.final_loss != null && data.b.final_loss != null
      ? data.b.final_loss - data.a.final_loss
      : null;
  const sameLossKind = data ? data.a.loss_kind === data.b.loss_kind : false;
  const comparableLossDelta = sameLossKind ? lossDelta : null;
  const lossChange = data && sameLossKind ? relativeChange(data.a.final_loss, data.b.final_loss) : null;
  const bLossLower = comparableLossDelta != null && comparableLossDelta < 0;
  const bLossHigher = comparableLossDelta != null && comparableLossDelta > 0;
  const lossTone = bLossLower ? "positive" : bLossHigher ? "negative" : "neutral";
  const lossHeadline =
    !sameLossKind
      ? "—"
      : lossChange == null
      ? "—"
      : fmt(Math.abs(lossChange), { pct: true, digits: 3 });
  const lossHeadlineLabel = !sameLossKind
    ? "Loss metrics differ"
    : data?.summary.losses_comparable
      ? bLossLower
      ? "B better by final loss"
      : bLossHigher
        ? "B worse by final loss"
        : "Final loss unchanged"
      : bLossLower
        ? `B lower ${lossKindLabel(data?.b.loss_kind)} loss`
        : bLossHigher
          ? `B higher ${lossKindLabel(data?.b.loss_kind)} loss`
          : `${isNormalizedLoss(data?.b.loss_kind) ? "Normalized" : "Raw"} loss unchanged`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Compare versions"
        description="Diff two published populace-US releases. Targets are matched by name; common targets get a fit change (negative = release B fits it better), and targets present in only one release are counted as added/removed."
      />

      <SectionCard title="Releases">
        {releasesLoading ? (
          <LoadingBlock label="Loading releases…" height="h-20" />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <ScopeSegmentedControl scope={scope} onChange={setScope} />
            <ToolbarSelect
              label="Release A"
              value={a}
              onChange={setA}
              options={options}
            />
            <span className="text-muted-foreground">→</span>
            <ToolbarSelect label="B (compare)" value={b} onChange={setB} options={options} />
          </div>
        )}
      </SectionCard>

      {isLoading ? (
        <LoadingBlock label="Comparing releases…" />
      ) : error || !data ? (
        <EmptyState
          title="Comparison unavailable"
          description={error instanceof Error ? error.message : "Pick two releases above."}
        />
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            A <span className="font-medium text-foreground">{dateOf(a)}</span>
            {"  →  "}
            B <span className="font-medium text-foreground">{dateOf(b)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label={scope === "healthcare" ? "Healthcare targets A → B" : "Targets A → B"}
              value={`${fmt(data.a.total_targets, { digits: 0 })} → ${fmt(data.b.total_targets, { digits: 0 })}`}
              hint={`${fmt(data.summary.common, { digits: 0 })} in common`}
            />
            <KpiCard
              label="Added / removed"
              value={`+${fmt(data.summary.added, { digits: 0 })} / −${fmt(data.summary.removed, { digits: 0 })}`}
              hint="targets only in B / only in A"
            />
            <KpiCard
              label="Improved"
              value={fmt(data.summary.improved, { digits: 0 })}
              tone="positive"
              hint={`${fmt(data.summary.regressed, { digits: 0 })} regressed, ${fmt(data.summary.unchanged, { digits: 0 })} unchanged`}
            />
            <KpiCard
              label="Within 10% A → B"
              value={`${fmt(data.a.fraction_within_10pct, { pct: true, digits: 0 })} → ${fmt(data.b.fraction_within_10pct, { pct: true, digits: 0 })}`}
              hint={`${fmt(data.summary.common, { digits: 0 })} common targets`}
            />
          </div>

          {scope === "healthcare" ? (
            <SectionCard
              title="Healthcare fit by program"
              description="Mean absolute relative error across common healthcare targets; negative fit change means release B is closer to target."
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {healthcareProgramSummaries.map((summary) => (
                  <KpiCard
                    key={summary.key}
                    label={summary.label}
                    value={`${relErr(summary.aMeanAbsError)} → ${relErr(summary.bMeanAbsError)}`}
                    delta={
                      summary.fitChange == null ? null : fmtPointDelta(summary.fitChange)
                    }
                    tone={summaryTone(summary.fitChange)}
                    hint={
                      summary.commonTargets
                        ? `${fmt(summary.commonTargets, { digits: 0 })} common targets`
                        : "No common targets"
                    }
                    size="sm"
                  />
                ))}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Version-over-version loss"
            description={
              !sameLossKind
                ? "Release A and B report different loss metrics, so their final loss values should not be compared directly."
                : data.summary.losses_comparable
                ? "Final optimizer loss for B compared with A. Lower is better when target surfaces match."
                : `${isNormalizedLoss(data.b.loss_kind) ? "Normalized target loss" : "Raw optimizer loss"} for B compared with A. These releases have different target surfaces, so treat this as directional context rather than a clean apples-to-apples fit score.`
            }
          >
            <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
              <KpiCard
                label={lossHeadlineLabel}
                value={lossHeadline}
                tone={lossTone}
                hint={
                  !sameLossKind
                    ? `${lossKindLabel(data.a.loss_kind)} → ${lossKindLabel(data.b.loss_kind)}`
                    : comparableLossDelta == null
                    ? "final loss unavailable"
                    : `${fmtLoss(data.a.final_loss, data.a.loss_kind)} → ${fmtLoss(data.b.final_loss, data.b.loss_kind)}`
                }
                size="lg"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Release</th>
                      <th className="px-3 py-2 text-right font-semibold">Initial loss</th>
                      <th className="px-3 py-2 text-right font-semibold">Final loss</th>
                      <th className="px-3 py-2 text-right font-semibold">Within-run reduction</th>
                    </tr>
                  </thead>
                  <tbody>
                    <LossRow
                      label="A"
                      initial={data.a.initial_loss}
                      final={data.a.final_loss}
                      lossKind={data.a.loss_kind}
                    />
                    <LossRow
                      label="B"
                      initial={data.b.initial_loss}
                      final={data.b.final_loss}
                      lossKind={data.b.loss_kind}
                    />
                    <tr className="border-t border-border bg-muted/20">
                      <td className="px-3 py-2 font-medium">B vs A final</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          bLossLower ? "text-emerald-700" : bLossHigher ? "text-rose-700" : ""
                        }`}
                      >
                        {comparableLossDelta == null
                          ? "—"
                          : fmtLoss(Math.abs(comparableLossDelta), data.b.loss_kind)}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          bLossLower ? "text-emerald-700" : bLossHigher ? "text-rose-700" : ""
                        }`}
                      >
                        {lossChange == null
                          ? "—"
                          : fmtSigned(lossChange, { pct: true, digits: 3 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard
              title="Most improved (B vs A)"
              description="Common non-zero targets whose absolute relative error fell the most from A to B, excluding tiny-denominator extremes above 1000%."
              padded={false}
            >
              <MoverList rows={improvements} />
            </SectionCard>
            <SectionCard
              title="Most regressed (B vs A)"
              description="Common non-zero targets whose absolute relative error rose the most from A to B, excluding tiny-denominator extremes above 1000%."
              padded={false}
            >
              <MoverList rows={regressions} />
            </SectionCard>
          </div>

          <SectionCard
            title={
              scope === "healthcare"
                ? "Healthcare targets version over version"
                : "All targets version over version"
            }
            description="Every common target matched across releases. Negative |err| change means B fits that target better than A."
          >
            <TargetComparisonTable rows={data.rows ?? []} />
          </SectionCard>
        </>
      )}
    </div>
  );
}
