"use client";

import { useEffect, useRef } from "react";

import { fmt, fmtCompact, fmtSigned } from "@/components/shared/format";
import { StatusPill } from "@/components/shared/status-pill";
import {
  type MicrocosmTargetDimension,
  type MicrocosmTargetRow,
} from "@/lib/api/hooks/use-microcosm";
import { chronicleSourceEntryUrl } from "@/lib/microcosm/chronicle-entry-url";
import { canonicalLabel } from "@/lib/microcosm/program-label";
import { sourceLabel } from "@/lib/microcosm/source-label";
import { usStateName } from "@/lib/microcosm/us-state-names";

interface DisplayDimension {
  label: string;
  value: string;
}

function facetValue(row: MicrocosmTargetRow, key: string): string {
  const targetDimension = row.target_dimensions?.find((dim) => dim.key === key);
  if (targetDimension) return targetDimension.value;
  const dim = /^dim(\d+)$/.exec(key);
  if (dim) return row.dims?.[Number(dim[1])] ?? "";
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function cleanDimensionValue(value: string): string {
  return value.replace(/^AGI in /, "");
}

function titleFromIdentifier(value: string | null | undefined): string {
  if (!value) return "";
  const leaf = value.split(/[.#:]/).filter(Boolean).at(-1) ?? value;
  return canonicalLabel(leaf.replace(/[^a-zA-Z0-9]+/g, "_"));
}

function periodText(row: MicrocosmTargetRow): string {
  const target = row.chronicle?.target_period ?? (row.period == null ? null : String(row.period));
  const source = row.chronicle?.source_period;
  if (target && source && target !== source) return `${source} → ${target}`;
  return target ?? source ?? "";
}

function measureText(row: MicrocosmTargetRow): string {
  return (
    titleFromIdentifier(row.chronicle?.measure_concept) ||
    canonicalLabel(row.variable as string) ||
    titleFromIdentifier(row.chronicle?.layout_measure_id) ||
    canonicalLabel(row.measure_name)
  );
}

function relativeErrorText(value: number | null): string {
  if (value == null) return "—";
  const digits = Math.abs(value) >= 0.995 ? 2 : 1;
  return fmt(value, { pct: true, digits });
}

function signedRelativeErrorText(value: number | null): string {
  if (value == null) return "—";
  const digits = Math.abs(value) >= 0.995 ? 2 : 1;
  return fmtSigned(value, { pct: true, digits });
}

function errorText(
  errorKind: MicrocosmTargetRow["error_kind"],
  value: number | null,
  signed = false,
): string {
  if (errorKind === "absolute") return fmtCompact(value);
  return signed ? signedRelativeErrorText(value) : relativeErrorText(value);
}

function estimateText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return fmt(value, { digits: Number.isInteger(value) ? 0 : 2 });
}

function calibrationStatusTone(
  status: MicrocosmTargetRow["calibration_status"],
): "success" | "warning" | "neutral" {
  if (status === "included") return "success";
  if (status === "skipped" || status === "not_materialized") return "warning";
  return "neutral";
}

function dimensionPhrase(dimension: DisplayDimension): string {
  const value = cleanDimensionValue(dimension.value);
  const label = dimension.label.toLowerCase();
  if (label === "income band") return `${value} income`;
  if (label === "filing status") {
    return value.toLowerCase() === "all" ? "all filing statuses" : `${value} filing status`;
  }
  if (value.toLowerCase() === "all") return `all ${label}`;
  return `${dimension.label}: ${value}`;
}

function naturalList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function niceAxisLimit(value: number, minimum: number): number {
  const target = Math.max(value, minimum);
  const exponent = 10 ** Math.floor(Math.log10(target));
  const normalized = target / exponent;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * exponent;
}

function errorPosition(value: number | null, limit: number): number {
  if (value == null || !Number.isFinite(value) || limit <= 0) return 50;
  return Math.max(4, Math.min(96, 50 + (value / limit) * 46));
}

function axisLabel(
  value: number,
  errorKind: MicrocosmTargetRow["error_kind"],
): string {
  if (errorKind === "absolute") return fmtCompact(value);
  const digits = value < 0.1 ? 1 : 0;
  return fmt(value, { pct: true, digits });
}

function improvementSummary(
  improvement: number | null,
  errorKind: MicrocosmTargetRow["error_kind"],
): { text: string; tone: "positive" | "negative" | "neutral" } | null {
  if (improvement == null || !Number.isFinite(improvement)) return null;
  if (Math.abs(improvement) < 0.00005) {
    return { text: "Calibration left the absolute error essentially unchanged.", tone: "neutral" };
  }
  const reduced = improvement > 0;
  const amount =
    errorKind === "absolute"
      ? fmtCompact(Math.abs(improvement))
      : `${(Math.abs(improvement) * 100).toFixed(Math.abs(improvement) >= 0.1 ? 1 : 2)} percentage points`;
  return {
    text: `Calibration ${reduced ? "reduced" : "increased"} the absolute error by ${amount}.`,
    tone: reduced ? "positive" : "negative",
  };
}

function Metric({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="min-w-0 px-4 py-3.5 text-center sm:px-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-2xl font-semibold tabular-nums ${
          tone === "positive" ? "tone-pos" : tone === "negative" ? "tone-neg" : "text-foreground"
        }`}
        title={value}
      >
        {value}
      </div>
      {caption ? <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div> : null}
    </div>
  );
}

function CombinedErrorTrack({
  initial,
  final,
  initialLabel,
  finalLabel,
  limit,
  errorKind,
}: {
  initial: number | null;
  final: number | null;
  initialLabel: string;
  finalLabel: string;
  limit: number;
  errorKind: MicrocosmTargetRow["error_kind"];
}) {
  const initialPosition = errorPosition(initial, limit);
  const finalPosition = errorPosition(final, limit);
  const initialStart = Math.min(50, initialPosition);
  const finalStart = Math.min(50, finalPosition);
  return (
    <div
      className="group relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
      tabIndex={0}
      role="img"
      aria-label={`Before calibration: ${initialLabel}. After calibration: ${finalLabel}.`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full swatch-warn" /> Before calibration
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full swatch-pos" /> After calibration
        </span>
        <span className="hidden text-[10px] sm:inline">Hover for values</span>
      </div>

      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <svg
          aria-hidden="true"
          viewBox="0 0 8 8"
          className="absolute left-0 top-1/2 h-2 w-2 -translate-x-px -translate-y-1/2 text-border"
        >
          <path d="M6.5 0.75 2.5 4l4 3.25" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
        <svg
          aria-hidden="true"
          viewBox="0 0 8 8"
          className="absolute right-0 top-1/2 h-2 w-2 translate-x-px -translate-y-1/2 text-border"
        >
          <path d="m1.5 0.75 4 3.25-4 3.25" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
        {initial != null ? (
          <span
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full swatch-warn opacity-25"
            style={{ left: `${initialStart}%`, width: `${Math.abs(initialPosition - 50)}%` }}
          />
        ) : null}
        {final != null ? (
          <span
            className="absolute top-1/2 z-10 h-1 -translate-y-1/2 rounded-full swatch-pos opacity-50"
            style={{ left: `${finalStart}%`, width: `${Math.abs(finalPosition - 50)}%` }}
          />
        ) : null}
        <div className="absolute left-1/2 top-0 h-8 w-px bg-muted-foreground/60" />
        {initial != null ? (
          <span
            className="absolute top-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow-sm swatch-warn"
            style={{ left: `${initialPosition}%` }}
          />
        ) : null}
        {final != null ? (
          <span
            className="absolute top-1/2 z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow-sm swatch-pos"
            style={{ left: `${finalPosition}%` }}
          />
        ) : null}
      </div>

      <div className="flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>−{axisLabel(limit, errorKind)}</span>
        <span>target</span>
        <span>+{axisLabel(limit, errorKind)}</span>
      </div>

      <div className="pointer-events-none absolute bottom-[calc(100%-1.4rem)] left-1/2 z-40 w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus:opacity-100">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full swatch-warn" /> Before
          </span>
          <span className="font-mono font-semibold tabular-nums text-foreground">{initialLabel}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full swatch-pos" /> After
          </span>
          <span className="font-mono font-semibold tabular-nums text-foreground">{finalLabel}</span>
        </div>
      </div>
    </div>
  );
}

function ErrorComparison({
  initial,
  final,
  errorKind,
  improvement,
}: {
  initial: number | null;
  final: number | null;
  errorKind: MicrocosmTargetRow["error_kind"];
  improvement: number | null;
}) {
  const minimum = errorKind === "absolute" ? 1 : 0.1;
  const limit = niceAxisLimit(Math.max(Math.abs(initial ?? 0), Math.abs(final ?? 0)), minimum);
  const summary = improvementSummary(improvement, errorKind);
  return (
    <div className="mx-2 my-6 md:my-0 md:self-center">
      <CombinedErrorTrack
        initial={initial}
        final={final}
        initialLabel={errorText(errorKind, initial, true)}
        finalLabel={errorText(errorKind, final, true)}
        limit={limit}
        errorKind={errorKind}
      />
      {summary ? (
        <p
          className={`mt-4 text-center text-xs font-medium ${
            summary.tone === "positive"
              ? "tone-pos"
              : summary.tone === "negative"
                ? "tone-neg"
                : "text-muted-foreground"
          }`}
        >
          {summary.text}
        </p>
      ) : null}
    </div>
  );
}

function DefinitionItem({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

function CodeChips({ values }: { values: string[] }) {
  if (!values.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <code key={value} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-foreground">
          {value}
        </code>
      ))}
    </span>
  );
}

function Disclosure({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-t border-border/70 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        </span>
        <span className="shrink-0 text-sm text-muted-foreground transition-transform group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="border-t border-border/60 bg-muted/10 px-5 py-4">{children}</div>
    </details>
  );
}

export function MicrocosmTargetDetail({
  row,
  dimensions,
  onClose,
}: {
  row: MicrocosmTargetRow;
  dimensions: MicrocosmTargetDimension[];
  onClose: () => void;
}) {
  const target = typeof row.target === "number" ? row.target : null;
  const initial = typeof row.initial_estimate === "number" ? row.initial_estimate : null;
  const final = typeof row.final_estimate === "number" ? row.final_estimate : null;
  const initialRelative =
    typeof row.initial_relative_error === "number"
      ? row.initial_relative_error
      : typeof row.initial_error === "number"
        ? row.initial_error
        : null;
  const finalRelative =
    typeof row.relative_error === "number"
      ? row.relative_error
      : typeof row.final_error === "number"
        ? row.final_error
        : null;
  const errorKind = row.error_kind ?? (target === 0 ? "absolute" : "relative");
  const initialError =
    errorKind === "absolute"
      ? typeof row.initial_miss === "number"
        ? row.initial_miss
        : typeof row.initial_error === "number"
          ? row.initial_error
          : null
      : initialRelative;
  const finalError =
    errorKind === "absolute"
      ? typeof row.final_miss === "number"
        ? row.final_miss
        : typeof row.final_error === "number"
          ? row.final_error
          : null
      : finalRelative;
  const improvement = typeof row.improvement === "number" ? row.improvement : null;
  const within10 =
    errorKind === "relative" && typeof row.abs_relative_error === "number"
      ? row.abs_relative_error <= 0.1
      : null;
  const chronicle = row.chronicle;
  const policyengineVariables = row.policyengine_variables ?? [];
  const chronicleEntryUrl = chronicleSourceEntryUrl(
    row.source_citation,
    chronicle?.layout_record_set_id,
  );
  const sourceName = row.source ? sourceLabel(row.source) : "Source not specified";
  const measure = measureText(row) || titleFromIdentifier(row.name) || "Calibration target";

  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [row.name]);

  const shownDimensions: DisplayDimension[] = dimensions.length
    ? dimensions
        .filter((dimension) => dimension.key !== "geography" && dimension.key !== "level")
        .map((dimension) => ({ label: dimension.label, value: facetValue(row, dimension.key) }))
        .filter((dimension) => dimension.value)
    : row.target_dimensions?.length
      ? row.target_dimensions.map((dimension) => ({
          label: dimension.label,
          value: dimension.value,
        }))
      : (row.dims ?? []).map((value, index) => ({
          label: `Breakdown ${index + 1}`,
          value,
        }));

  const headerScope = [
    usStateName(row.geography) || null,
    ...shownDimensions.map(dimensionPhrase),
  ].filter((value): value is string => Boolean(value));
  const metricTone = within10 == null ? "neutral" : within10 ? "positive" : "negative";
  const unit = chronicle?.measure_unit?.toUpperCase() || null;

  return (
    <article
      ref={rootRef}
      className="scroll-mt-28 overflow-hidden rounded-xl border border-primary/30 bg-card shadow-[var(--elev-2)]"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 bg-muted/15 px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0 flex-1">
          <div className="site-eyebrow">Calibration target</div>
          <h2 className="mt-1 text-xl font-semibold leading-tight tracking-tight text-foreground">
            {measure}
          </h2>
          {headerScope.length ? (
            <p className="mt-1 text-sm text-foreground">{naturalList(headerScope)}</p>
          ) : null}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {sourceName}
            {periodText(row) ? ` · ${periodText(row)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.calibration_status !== "included" ? (
            <StatusPill tone={calibrationStatusTone(row.calibration_status)}>
              {row.calibration_status_label ?? "Calibration status unknown"}
            </StatusPill>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full border border-border text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            aria-label="Close target details"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
              <path
                d="M4 4l8 8m0-8-8 8"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-5">
        <section aria-labelledby="target-fit-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="target-fit-heading" className="text-sm font-semibold text-foreground">
                Fit after calibration
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                How the weighted estimate moved relative to the official target.
              </p>
            </div>
            {within10 === false ? (
              <StatusPill tone="danger">
                Outside 10%
              </StatusPill>
            ) : null}
          </div>

          <div className="mt-4 grid md:grid-cols-2">
            <div className="mx-2 grid grid-cols-3 divide-x divide-border/70 border border-border/70 md:self-center">
              <Metric
                label="Final estimate"
                value={estimateText(final)}
                caption={unit ?? undefined}
              />
              <Metric
                label="Official target"
                value={estimateText(target)}
                caption={unit ?? undefined}
              />
              <Metric
                label={errorKind === "absolute" ? "Final miss" : "Final error"}
                value={errorText(errorKind, finalError, true)}
                caption={errorKind === "absolute" ? "Absolute difference" : "Relative to target"}
                tone={metricTone}
              />
            </div>
            <ErrorComparison
              initial={initialError}
              final={finalError}
              errorKind={errorKind}
              improvement={improvement}
            />
          </div>
        </section>

        {row.estimate_warning ? (
          <div className="mt-4 rounded-md border pill-warn px-3.5 py-3 text-xs leading-relaxed">
            {row.estimate_warning}
          </div>
        ) : null}
        {row.calibration_status_reason ? (
          <div className="mt-4 rounded-md border pill-warn px-3.5 py-3 text-xs leading-relaxed">
            {row.calibration_status_reason}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/80">
        <Disclosure
          title="What this target measures"
          description="Topic, geography, period, and target dimensions"
        >
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <DefinitionItem label="Measure" value={measure} />
            <DefinitionItem label="Unit" value={unit} />
            <DefinitionItem label="Domain" value={titleFromIdentifier(chronicle?.domain)} />
            <DefinitionItem label="Geography" value={usStateName(row.geography)} />
            <DefinitionItem label="Geography level" value={chronicle?.geography_level || row.level} />
            <DefinitionItem label="Period" value={periodText(row)} />
            {shownDimensions.map((dimension) => (
              <DefinitionItem
                key={`definition:${dimension.label}:${dimension.value}`}
                label={dimension.label}
                value={cleanDimensionValue(dimension.value)}
              />
            ))}
          </dl>
        </Disclosure>

        <Disclosure
          title="PolicyEngine calculation"
          description="Model entity and filters used to produce the estimate"
        >
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
            <DefinitionItem label="Entity" value={canonicalLabel(row.entity)} />
            <DefinitionItem label="Counted per" value={row.policyengine_map_to} />
            <DefinitionItem label="Filter" value={row.policyengine_filter_variable} />
          </dl>
        </Disclosure>

        <Disclosure
          title="Source and calculation details"
          description="Chronicle source entry and model mapping used for the estimate"
        >
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <DefinitionItem label="Source" value={sourceName} />
            <DefinitionItem
              label="Chronicle entry"
              value={
                chronicleEntryUrl ? (
                  <a
                    href={chronicleEntryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    View Chronicle entry ↗
                  </a>
                ) : (
                  "Not available"
                )
              }
            />
            <DefinitionItem label="Measure concept" value={chronicle?.measure_concept} />
            <DefinitionItem label="Source concept" value={chronicle?.source_concept} />
            <DefinitionItem
              label="Model variables"
              value={policyengineVariables.length ? <CodeChips values={policyengineVariables} /> : null}
            />
            <DefinitionItem label="Counted per" value={row.policyengine_map_to} />
            <DefinitionItem label="Filter variable" value={row.policyengine_filter_variable} />
            <DefinitionItem label="Target role" value={row.target_role} />
            <DefinitionItem label="Materializer" value={row.materializer} />
          </dl>
        </Disclosure>

        <Disclosure
          title="Technical identifiers and lineage"
          description="Canonical keys for debugging and reproducibility"
        >
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <DefinitionItem label="Target name" value={row.name} />
            <DefinitionItem label="Source record ID" value={chronicle?.source_record_id} />
            <DefinitionItem label="Record set" value={chronicle?.layout_record_set_id} />
            <DefinitionItem label="Dimension set" value={chronicle?.dimension_set_key} />
            <DefinitionItem label="Universe constraints" value={chronicle?.universe_constraint_set_key} />
            <DefinitionItem label="Group-by dimension" value={chronicle?.layout_groupby_dimension} />
            <DefinitionItem label="Group-by value" value={chronicle?.layout_groupby_value_id} />
            <DefinitionItem label="Measure name" value={row.measure_name} />
          </dl>
        </Disclosure>
      </div>
    </article>
  );
}
