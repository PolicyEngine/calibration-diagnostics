"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, humanizeName } from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import { PopulaceTargetDetail } from "@/components/populace/populace-target-detail";
import {
  releaseSelectOptions,
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

type TargetScope = "all" | "healthcare";

interface HealthcareSummary {
  nTargets: number;
  within10Pct: number;
  meanAbsRelativeError: number | null;
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

function dimensionSummary(row: PopulaceTargetRow): string {
  const dims = row.target_dimensions?.map((dim) => dim.value).filter(Boolean) ?? [];
  if (dims.length) return dims.join(" · ");
  const group = row.ledger?.layout_groupby_value_id;
  if (group && group !== "all") return humanizeName(group);
  return "All";
}

function calculationLine(row: {
  policyengine_variables?: string[] | null;
  policyengine_map_to?: string | null;
  policyengine_filter_variable?: string | null;
}): string | null {
  const variables = row.policyengine_variables ?? [];
  if (!variables.length) return null;
  const suffix = [
    row.policyengine_map_to ? `map_to ${row.policyengine_map_to}` : null,
    row.policyengine_filter_variable ? `filter ${row.policyengine_filter_variable}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${variables.join(" + ")}${suffix ? ` · ${suffix}` : ""}`;
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
        {calculationLine(row) ? (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            calc {calculationLine(row)}
          </div>
        ) : null}
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

function healthcareSummary(variables: PopulaceVariableRow[]): HealthcareSummary {
  let nTargets = 0;
  let within10Pct = 0;
  let weightedAbsError = 0;
  let weightedAbsErrorTargets = 0;

  for (const variable of variables) {
    nTargets += variable.n_targets;
    within10Pct += variable.within_10pct;
    if (variable.mean_abs_relative_error != null && Number.isFinite(variable.mean_abs_relative_error)) {
      weightedAbsError += variable.mean_abs_relative_error * variable.n_targets;
      weightedAbsErrorTargets += variable.n_targets;
    }
  }

  return {
    nTargets,
    within10Pct,
    meanAbsRelativeError: weightedAbsErrorTargets
      ? weightedAbsError / weightedAbsErrorTargets
      : null,
  };
}


const SOURCE_LABELS: Record<string, string> = {
  irs_soi: "IRS — income & taxes",
  census_population: "Census — population",
  cms_aca: "CMS — ACA marketplace",
  cms_medicaid: "CMS — Medicaid & CHIP",
  cms_medicare: "CMS — Medicare",
  hhs_acf_tanf: "HHS — TANF",
  usda_snap: "USDA — SNAP",
  ssa: "Social Security",
  cbo: "CBO projections",
  jct: "JCT scores",
  state_income_tax: "State income tax",
};

function sourceLabel(source: string): string {
  return (
    SOURCE_LABELS[source] ??
    source
      .split("_")
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
      .join(" ")
  );
}

// Friendlier statistic picker: statistics grouped under plain-English source
// headings, each a clean card with a fit dot, human name, and amount/count
// pills — no source codes, calc lines, or variable_key clutter.
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
  const q = query.trim().toLowerCase();
  const filtered = q
    ? groups.filter((group) =>
        [group.variable, sourceLabel(group.source), group.source]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : groups;
  const sections = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const group of filtered) {
      const list = map.get(group.source) ?? map.set(group.source, []).get(group.source)!;
      list.push(group);
    }
    return [...map.entries()]
      .map(([source, items]) => ({
        source,
        items: [...items].sort((a, b) => b.nTargets - a.nTargets),
        total: items.reduce((sum, item) => sum + item.nTargets, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={query}
          placeholder="Search statistics — e.g. EITC, Medicaid, income…"
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 w-full rounded-lg border border-border bg-white px-3.5 text-sm focus:border-primary/60 focus:outline-none"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each bar shows the share of that statistic&apos;s breakdowns whose calibrated
          estimate lands within 10% of the official published figure.
        </p>
      </div>
      {sections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No statistics match “{query}”.
        </div>
      ) : (
        sections.map((section) => (
          <div key={section.source}>
            <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-border/70 pb-2">
              <h3 className="text-sm font-semibold text-foreground">{sourceLabel(section.source)}</h3>
              <span className="shrink-0 text-xs text-muted-foreground">
                {fmt(section.items.length, { digits: 0 })} statistics · {fmt(section.total, { digits: 0 })} targets
              </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {section.items.map((group) => {
                const share = group.nTargets ? group.within10Pct / group.nTargets : null;
                const isActive = group.options.some((option) => option.key === active);
                const hasMeasures = group.options.length > 1;
                return (
                  <button
                    key={group.groupKey}
                    type="button"
                    onClick={() => onPick(group.defaultKey)}
                    className={`group flex flex-col gap-3 rounded-xl border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      isActive ? "border-primary ring-1 ring-primary" : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                        {humanizeName(group.variable)}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmt(group.nTargets, { digits: 0 })}
                      </span>
                    </div>

                    <div className="mt-auto">
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                          Within 10%
                        </span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                          {share == null ? "—" : fmt(share, { pct: true, digits: 0 })}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${Math.round((share ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>

                    {hasMeasures ? (
                      <div
                        className="flex flex-wrap gap-1.5"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {group.options.map((option) => (
                          <span
                            key={option.key}
                            role="button"
                            tabIndex={0}
                            onClick={() => onPick(option.key)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onPick(option.key);
                              }
                            }}
                            className="cursor-pointer rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
                          >
                            {option.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] font-medium text-muted-foreground/70">
                        {group.options[0].label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

type WizardStep = "home" | "pick" | "refine" | "results";
type WizardAccent = "teal" | "amber" | "slate";

const ACCENTS: Record<
  WizardAccent,
  { chip: string; ink: string; border: string; glow: string }
> = {
  teal: {
    chip: "bg-primary/10 text-primary",
    ink: "text-primary",
    border: "hover:border-primary/50",
    glow: "group-hover:shadow-[0_18px_40px_-20px_rgba(49,151,149,0.55)]",
  },
  amber: {
    chip: "bg-amber-100 text-amber-700",
    ink: "text-amber-700",
    border: "hover:border-amber-400/60",
    glow: "group-hover:shadow-[0_18px_40px_-20px_rgba(217,119,6,0.5)]",
  },
  slate: {
    chip: "bg-slate-100 text-slate-600",
    ink: "text-slate-600",
    border: "hover:border-slate-400/60",
    glow: "group-hover:shadow-[0_18px_40px_-20px_rgba(71,85,105,0.45)]",
  },
};

function WizardCard({
  eyebrow,
  title,
  body,
  stat,
  accent,
  onClick,
}: {
  eyebrow: string;
  title: string;
  body: string;
  stat: string;
  accent: WizardAccent;
  onClick: () => void;
}) {
  const a = ACCENTS[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex h-full flex-col gap-5 rounded-2xl border border-border bg-white p-6 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-1 ${a.border} ${a.glow} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${a.ink}`}>
        {eyebrow}
      </span>
      <div className="flex-1">
        <h3 className="text-xl font-semibold leading-snug tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <span className={`text-sm font-semibold tabular-nums ${a.ink}`}>{stat}</span>
        <span
          className={`grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:border-current ${a.ink}`}
          aria-hidden
        >
          →
        </span>
      </div>
    </button>
  );
}

export function PopulaceTargetsView({
  initialScope = "all",
  initialSource = "",
}: {
  initialScope?: TargetScope;
  initialSource?: string;
}) {
  const [release, setRelease] = useState("");
  const [scope, setScope] = useState<TargetScope>(initialScope);
  const [variable, setVariable] = useState("");
  const [source, setSource] = useState(initialSource);
  const [level, setLevel] = useState("");
  const [geography, setGeography] = useState("");
  const [direction, setDirection] = useState("");
  const [withinTolerance, setWithinTolerance] = useState("");
  const [search, setSearch] = useState("");
  const [facetFilters, setFacetFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<PopulaceTargetRow | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>({ by: "abs_relative_error", dir: "desc" });
  const [step, setStep] = useState<WizardStep>(
    initialSource || initialScope === "healthcare" ? "results" : "home",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refineIndex, setRefineIndex] = useState(0);

  const { data: releaseData } = usePopulaceReleases();
  const releaseOptions = useMemo(() => releaseSelectOptions(releaseData), [releaseData]);
  const releases = releaseData?.releases ?? [];
  const currentReleaseId = release || releaseData?.latest_release_id || releases[0]?.release_id || "";
  const currentReleaseIndex = releases.findIndex((entry) => entry.release_id === currentReleaseId);
  const previousRelease =
    currentReleaseIndex >= 0 ? releases[currentReleaseIndex + 1] : undefined;
  const healthcareCompareHref =
    previousRelease && currentReleaseId
      ? `/populace/compare?scope=healthcare&a=${encodeURIComponent(
          previousRelease.release_id,
        )}&b=${encodeURIComponent(currentReleaseId)}`
      : null;

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

  function resetFilters() {
    setVariable("");
    setFacetFilters({});
    setSource("");
    setLevel("");
    setGeography("");
    setDirection("");
    setWithinTolerance("");
    setSearch("");
    setScope("all");
    setSelected(null);
    setShowAdvanced(false);
    setRefineIndex(0);
    setPage(0);
  }

  function startOver() {
    resetFilters();
    setStep("home");
  }

  function startExplore() {
    resetFilters();
    setStep("pick");
  }

  function startHealthcare() {
    resetFilters();
    setScope("healthcare");
    setStep("results");
  }

  function startEverything() {
    resetFilters();
    setStep("results");
  }

  // Step back one level toward the starting cards.
  function goBack() {
    if (step === "results" && activeVariable) {
      setStep("refine");
      return;
    }
    if (step === "refine") {
      setStep("pick");
      return;
    }
    startOver();
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
      scope: scope === "healthcare" ? scope : undefined,
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
      scope,
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
  const health = useMemo(
    () => (scope === "healthcare" ? healthcareSummary(variables) : null),
    [scope, variables],
  );
  const filteredTotal = data?.filtered_total ?? 0;
  const allTargets = data?.total_targets ?? null;
  const pageCount = Math.max(Math.ceil(filteredTotal / PAGE_SIZE), 1);
  const activeVariable = variables.find((v) => v.variable_key === variable);

  // Guided "Explore" refine questions: the selected statistic's own breakdown
  // dimensions (placeholder-only ones dropped), then a fit-quality question.
  const usableDimensions = useMemo(
    () =>
      dimensions
        .map((d) => ({
          ...d,
          values: d.values.filter((v) => v && v !== "All" && v !== "Total"),
        }))
        .filter((d) => d.values.length > 0),
    [dimensions],
  );
  type RefineQuestion =
    | { kind: "dim"; key: string; label: string; values: string[] }
    | { kind: "fit"; key: "fit"; label: string };
  const refineQuestions: RefineQuestion[] = [
    ...usableDimensions.map((d) => ({
      kind: "dim" as const,
      key: d.key,
      label: d.label,
      values: d.values,
    })),
    { kind: "fit", key: "fit", label: "Fit quality" },
  ];
  const refineStepIndex = Math.min(refineIndex, refineQuestions.length - 1);

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
    if (key) {
      setSource("");
      setLevel("");
      setGeography("");
      setWithinTolerance("");
      setRefineIndex(0);
      setStep("refine");
    } else {
      setStep("pick");
    }
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

  const targetFilters = (
    <div className="border-b border-border bg-white px-4 py-3">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        <label className="grid min-w-0 gap-1">
          <span className="truncate text-xs font-medium text-muted-foreground">Search</span>
          <input
            type="search"
            value={search}
            placeholder="Search targets…"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            className="h-9 w-full rounded-md border border-border bg-white px-3 text-sm focus:border-primary/60 focus:outline-none"
          />
        </label>
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
                className="w-full"
                layout="stacked"
              />
            ))
          ) : (
            <>
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
                className="w-full"
                layout="stacked"
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
                className="w-full"
                layout="stacked"
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
                className="w-full"
                layout="stacked"
              />
            </>
          )}
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
            className="w-full"
            layout="stacked"
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
            className="w-full"
            layout="stacked"
          />
      </div>
    </div>
  );

  const activeMeasure =
    activeVariable?.measure === "total" || !activeVariable?.measure
      ? activeVariable
        ? "amount"
        : null
      : activeVariable.measure;

  const pathLabel = activeVariable
    ? `${activeVariable.source} / ${humanizeName(activeVariable.variable)}${activeMeasure ? ` · ${activeMeasure}` : ""}`
    : withinTolerance === "false"
      ? "Where calibration struggles"
      : scope === "healthcare"
        ? "Healthcare programs"
        : "All targets";

  const slimRefiners = (
    <div className="flex flex-wrap items-end gap-3 border-b border-border bg-white px-4 py-3">
      {activeVariable && dimensions.length ? (
        dimensions.map((dim) => (
          <ToolbarSelect
            key={dim.key}
            label={dim.label}
            value={facetFilters[dim.key] ?? ""}
            onChange={(value) => setFacet(dim.key, value)}
            options={[
              { value: "", label: "Any" },
              ...dim.values.map((value) => ({ value, label: value.replace(/^AGI in /, "") })),
            ]}
            layout="stacked"
          />
        ))
      ) : (
        <ToolbarSelect
          label="Source"
          value={source}
          onChange={(value) => {
            setSource(value);
            setSelected(null);
            setPage(0);
          }}
          options={[
            { value: "", label: "Any source" },
            ...sources.map((value) => ({ value, label: value })),
          ]}
          layout="stacked"
        />
      )}
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
          { value: "true", label: "Within 10%" },
          { value: "false", label: "Outside 10%" },
        ]}
        layout="stacked"
      />
    </div>
  );

  const resultsTable = isLoading ? (
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
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Target diagnostics"
        description="See how closely the calibrated weights reproduce each official statistic — by source, measure, and breakdown."
        actions={
          <ToolbarSelect
            label="Release"
            value={release}
            onChange={pickRelease}
            options={releaseOptions}
          />
        }
      />

      {step === "home" && (
        <div className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-foreground">
            Where would you like to start?
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <WizardCard
              eyebrow="Browse"
              title="Explore a statistic"
              body="Pick a measure like EITC, population, or AGI and see how each breakdown is calibrated."
              stat={variableGroupCount ? `${fmt(variableGroupCount, { digits: 0 })} statistics` : "Browse measures"}
              accent="teal"
              onClick={startExplore}
            />
            <WizardCard
              eyebrow="Focus"
              title="Healthcare programs"
              body="ACA marketplace, Medicaid, CHIP, and Medicare enrollment and premium targets."
              stat="ACA · Medicaid · Medicare"
              accent="teal"
              onClick={startHealthcare}
            />
            <WizardCard
              eyebrow="Everything"
              title="See everything"
              body="Browse the full target surface with all filters and column sorting."
              stat={allTargets != null ? `${fmt(allTargets, { digits: 0 })} targets` : "All targets"}
              accent="slate"
              onClick={startEverything}
            />
          </div>
        </div>
      )}

      {step === "pick" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
            >
              <span aria-hidden>←</span> Back
            </button>
            <span className="text-muted-foreground/50">/</span>
            <span className="font-semibold text-foreground">Pick a statistic</span>
          </div>
          <SectionCard
            title="Which statistic?"
            description={`${fmt(variableGroupCount, { digits: 0 })} measures in this release — pick one to see its breakdowns.`}
          >
            <VariableBrowser variables={variables} active={variable} onPick={pickVariable} />
          </SectionCard>
        </div>
      )}

      {step === "refine" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <button type="button" onClick={goBack} className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground">
                <span aria-hidden>←</span> Back
              </button>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-semibold text-foreground">
                {activeVariable ? humanizeName(activeVariable.variable) : "Statistic"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startOver}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                Start over
              </button>
              <button
                type="button"
                onClick={() => setStep("results")}
                className="rounded-md border border-primary bg-primary/5 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-primary/10"
              >
                Skip to results →
              </button>
            </div>
          </div>

          {isLoading || !data ? (
            <LoadingBlock label="Loading breakdowns…" />
          ) : (
            (() => {
              const q = refineQuestions[refineStepIndex];
              const isLast = refineStepIndex >= refineQuestions.length - 1;
              const current =
                q.kind === "fit" ? withinTolerance : facetFilters[q.key] ?? "";
              const options =
                q.kind === "fit"
                  ? [
                      { value: "", label: "Any fit" },
                      { value: "true", label: "Within 10%" },
                      { value: "false", label: "Outside 10%" },
                    ]
                  : [
                      { value: "", label: `Any ${q.label.toLowerCase()}` },
                      ...q.values.map((v) => ({ value: v, label: v.replace(/^AGI in /, "") })),
                    ];
              const setValue = (value: string) => {
                if (q.kind === "fit") setWithinTolerance(value);
                else setFacet(q.key, value);
              };
              const advance = () => {
                if (isLast) setStep("results");
                else setRefineIndex((i) => i + 1);
              };
              const prevQuestion = () => {
                if (refineStepIndex === 0) setStep("pick");
                else setRefineIndex((i) => Math.max(i - 1, 0));
              };
              const title =
                q.kind === "fit"
                  ? "Filter by fit quality?"
                  : `Narrow by ${q.label.toLowerCase()}?`;

              return (
                <SectionCard
                  title={
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        Step {refineStepIndex + 1} of {refineQuestions.length}
                      </span>
                    </span>
                  }
                  description={title}
                  footer={
                    <div className="flex items-center justify-between px-5 py-2.5 text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={prevQuestion}
                        className="rounded-md border border-border px-2.5 py-1 hover:bg-muted/60 hover:text-foreground"
                      >
                        ← Previous
                      </button>
                      <span>
                        <span className="font-mono font-semibold text-foreground">
                          {fmt(filteredTotal, { digits: 0 })}
                        </span>{" "}
                        targets match
                      </span>
                      <button
                        type="button"
                        onClick={() => setStep("results")}
                        className="rounded-md border border-primary bg-primary/5 px-2.5 py-1 font-medium text-foreground hover:bg-primary/10"
                      >
                        See results →
                      </button>
                    </div>
                  }
                >
                  <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto p-1">
                    {options.map((opt) => {
                      const active = current === opt.value;
                      return (
                        <button
                          key={opt.value || "__any__"}
                          type="button"
                          onClick={() => {
                            setValue(opt.value);
                            advance();
                          }}
                          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : opt.value === ""
                                ? "border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                                : "border-border bg-white text-foreground hover:border-primary/50 hover:bg-primary/5"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>
              );
            })()
          )}
        </div>
      )}

      {step === "results" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
              >
                <span aria-hidden>←</span> Back
              </button>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-semibold text-foreground">{pathLabel}</span>
              {activeVariable && (
                <button
                  type="button"
                  onClick={() => setStep("pick")}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60"
                >
                  change
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {scope === "healthcare" && healthcareCompareHref ? (
                <Link
                  href={healthcareCompareHref}
                  className="rounded-md border border-primary bg-primary/5 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-primary/10"
                >
                  Compare this release to previous
                </Link>
              ) : null}
              {activeVariable && (
                <button
                  type="button"
                  onClick={() => setShowAdvanced((value) => !value)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    showAdvanced
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  Advanced filters {showAdvanced ? "▴" : "▾"}
                </button>
              )}
              <button
                type="button"
                onClick={startOver}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                Start over
              </button>
            </div>
          </div>

          {health && data && !isLoading ? (
            <div className="grid gap-3 md:grid-cols-3">
              <KpiCard
                label="Healthcare targets"
                value={fmt(data.total_targets, { digits: 0 })}
                size="sm"
              />
              <KpiCard
                label="Within 10%"
                value={
                  health.nTargets
                    ? fmt(health.within10Pct / health.nTargets, { pct: true, digits: 0 })
                    : "—"
                }
                size="sm"
              />
              <KpiCard
                label="Mean abs error"
                value={fmt(health.meanAbsRelativeError, { pct: true, digits: 1 })}
                size="sm"
              />
            </div>
          ) : null}

          {selected && (
            <PopulaceTargetDetail
              row={selected}
              dimensions={dimensions}
              onClose={() => setSelected(null)}
            />
          )}

          <SectionCard
            title={`${fmt(filteredTotal, { digits: 0 })} of ${fmt(data?.total_targets ?? null, { digits: 0 })} targets`}
            description={
              activeVariable
                ? `${fmt(activeVariable.n_targets, { digits: 0 })} breakdowns · ${fmt(
                    activeVariable.within_10pct / Math.max(activeVariable.n_targets, 1),
                    { pct: true, digits: 0 },
                  )} within 10% · mean abs error ${fmt(activeVariable.mean_abs_relative_error, { pct: true, digits: 1 })}`
                : "Final estimate is after calibrated weights. Click any row for its full lineage."
            }
            padded={false}
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
            {!activeVariable || showAdvanced ? targetFilters : slimRefiners}
            {resultsTable}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
