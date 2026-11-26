"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ToolbarSelect } from "@/components/shared/toolbar-select";
import type { BuildMark } from "@/lib/microcosm/release-history-builds";
import { chartLayout, columnBand, sparklinePath } from "@/lib/microcosm/release-history-chart";
import {
  dateLong,
  dateShort,
  formatChange,
  formatPercent,
  formatValue,
  periodLabel,
  versusOfficial,
} from "@/lib/microcosm/release-history-format";
import {
  groupedOutputs,
  latestValue,
  referenceLine,
  type OutputEntry,
} from "@/lib/microcosm/release-history-outputs";
import type { TimelineBuild } from "@/lib/microcosm/release-history-store";
import type { PanelPresentation } from "@/lib/microcosm/release-history-summary";
import type { ChartScale } from "@/lib/microcosm/release-history-url";

import {
  DEFAULT_CHART_WIDTH,
  MarkLegend,
  ReleaseHistoryChart,
  Sparkline,
  useElementWidth,
  type ChartColumnReadout,
} from "./release-history-chart";
import { BuildChips } from "./release-history-sections";

// The outputs of the release history page (calibration-diagnostics#224): a navigator of every
// output by group, and the selected output's stats, chart, official reference and table.

const SCALES: { id: ChartScale; label: string }[] = [
  { id: "relative", label: "Relative (%)" },
  { id: "absolute", label: "Absolute" },
];

function unitName(unit: OutputEntry["unit"], currency: string | null): string {
  if (unit === "currency") return currency ? `in ${currency}` : "in currency";
  return { count: "a count", rate: "a share", ratio: "in percent" }[unit];
}

function capitalise(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

/** The outputs by group, with a search: each row has the output's line and its latest value. */
export function OutputNavigator({
  entries,
  builds,
  currency,
  selectedId,
  onSelect,
}: {
  entries: readonly OutputEntry[];
  builds: readonly TimelineBuild[];
  currency: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupedOutputs(entries), [entries]);
  // A link, or a row of "what moved", can select an output far down the list: bring it into view
  // inside the navigator, without moving the page.
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = list.current;
    const selected = container?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!container || !selected) return;
    const frame = container.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    // The search box stays pinned over the top 56px of the list.
    if (row.top < frame.top + 56) container.scrollTop -= frame.top + 56 - row.top;
    else if (row.bottom > frame.bottom) container.scrollTop += row.bottom - frame.bottom + 8;
  }, [selectedId]);
  const wanted = query.trim().toLowerCase();
  const shown = [...groups].flatMap(([group, outputs]): [string, OutputEntry[]][] => {
    const matches = outputs.filter(
      (entry) => !wanted || entry.label.toLowerCase().includes(wanted) || group.toLowerCase().includes(wanted),
    );
    return matches.length > 0 ? [[group, matches]] : [];
  });
  return (
    <nav
      ref={list}
      aria-label="Outputs by group"
      className="sticky top-24 hidden max-h-[calc(100dvh-8rem)] overflow-auto rounded-lg border border-border bg-card lg:block"
    >
      <div className="sticky top-0 z-[1] border-b border-border bg-card p-2.5">
        <label className="sr-only" htmlFor="release-history-output-search">
          Find an output
        </label>
        <input
          id="release-history-output-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an output"
          autoComplete="off"
          className="w-full rounded-md border border-border-dark bg-background px-2.5 py-1.5 text-sm"
        />
      </div>
      {shown.map(([group, outputs]) => (
        <div key={group}>
          <h3 className="px-3 pb-1 pt-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {group}
          </h3>
          <ul className="m-0 grid list-none gap-px px-1.5 pb-1.5">
            {outputs.map((entry) => {
              const latest = latestValue(entry, builds);
              const line = sparklinePath(entry, builds);
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    title={entry.fullLabel}
                    aria-current={entry.id === selectedId ? "true" : undefined}
                    onClick={() => onSelect(entry.id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_56px_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted ${
                      entry.id === selectedId ? "bg-[var(--accent-subtle)]" : ""
                    }`}
                  >
                    <span className="truncate text-[13px]">{entry.label}</span>
                    <Sparkline path={line.path} last={line.last} />
                    <span className="whitespace-nowrap text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
                      {latest ? formatValue(latest.value, entry.unit, currency) : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {shown.length === 0 && <p className="p-3 text-[13px] text-muted-foreground">No output matches “{query}”.</p>}
    </nav>
  );
}

function Stat({ label, value, small = false }: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      <span className={small ? "pt-1 text-base font-semibold" : "text-[22px] font-semibold"}>{value}</span>
    </div>
  );
}

/** What one column of the chart says, in the tooltip and to a screen reader. */
function columnReadout(options: {
  entry: OutputEntry;
  builds: readonly TimelineBuild[];
  names: ReadonlyMap<string, string>;
  currency: string | null;
  relative: boolean;
  index: number;
}): ChartColumnReadout {
  const { entry, builds, currency, index } = options;
  const build = builds[index];
  const value = entry.values[index];
  const title = `${dateLong(build.publishedAt)} · ${options.names.get(build.buildId) ?? build.build}`;
  const before = value.comparedWith === null ? null : builds.find((candidate) => candidate.buildId === value.comparedWith);
  const step = before
    ? `From ${dateShort(before.publishedAt)}: ${formatChange(value, entry.unit, currency)}.`
    : build.withdrawn
      ? "Withdrawn: no step joins it."
      : "No step to this build.";
  if (value.value === null) {
    const band = columnBand(build, value.status) ?? "no value";
    return { title, value: capitalise(band), detail: build.reason, step };
  }
  const amount = formatValue(value.value, entry.unit, currency, 2);
  const versus = entry.official === null
    ? null
    : `${formatPercent(versusOfficial(value.value, entry.official))} against the official figure`;
  return options.relative && versus
    ? { title, value: versus, detail: amount, step }
    : { title, value: amount, detail: versus ?? "No official figure", step };
}

function ValuesTable({
  entry,
  builds,
  marks,
  names,
  currency,
  selectedIndex,
  onSelect,
}: {
  entry: OutputEntry;
  builds: readonly TimelineBuild[];
  marks: readonly BuildMark[][];
  names: ReadonlyMap<string, string>;
  currency: string | null;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const official = entry.official;
  const heading = "border-b border-border-dark px-2.5 py-1.5 text-left align-bottom font-mono text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground";
  const cell = "border-b border-border px-2.5 py-1.5 whitespace-nowrap";
  const number = `${cell} text-right font-mono text-[12.5px] tabular-nums`;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={heading}>Build</th>
            <th scope="col" className={heading}>Published</th>
            <th scope="col" className={`${heading} text-right`}>Value</th>
            {official !== null && <th scope="col" className={`${heading} text-right`}>Against official</th>}
            <th scope="col" className={`${heading} text-right`}>Step from the build before</th>
            <th scope="col" className={heading}>Status</th>
          </tr>
        </thead>
        <tbody>
          {builds.map((build, index) => {
            const value = entry.values[index];
            const band = value.value === null ? columnBand(build, value.status) : null;
            return (
              <tr key={build.buildId} className={`${selectedIndex === index ? "bg-[var(--accent-subtle)]" : ""} ${build.withdrawn ? "text-muted-foreground" : ""}`}>
                <td className={`${cell} max-w-[210px] truncate font-mono text-xs`} title={build.buildId}>
                  <button
                    type="button"
                    onClick={() => onSelect(index)}
                    className={`underline decoration-dotted underline-offset-2 hover:text-primary ${build.withdrawn ? "line-through" : ""}`}
                  >
                    {names.get(build.buildId) ?? build.build}
                  </button>
                </td>
                <td className={cell}>{dateLong(build.publishedAt)}</td>
                <td className={number}>{value.value === null ? "—" : formatValue(value.value, entry.unit, currency, 2)}</td>
                {official !== null && (
                  <td className={number}>
                    {value.value === null ? "—" : formatPercent(versusOfficial(value.value, official))}
                  </td>
                )}
                <td className={number}>{formatChange(value, entry.unit, currency)}</td>
                <td className={cell}>
                  <span className="flex flex-wrap items-center gap-1">
                    {band && band !== "withdrawn" && (
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${band === "withheld" ? "pill-warn" : "pill-neutral"}`}>
                        {capitalise(band)}
                      </span>
                    )}
                    <BuildChips build={build} builds={builds} marks={marks[index] ?? []} withState={false} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The selected output: its stats, the Relative / Absolute switch, the chart and the table. */
export function OutputDetail({
  entry,
  entries,
  periods,
  period,
  builds,
  marks,
  names,
  presentation,
  scale,
  stepIndex,
  onScale,
  onPeriod,
  onSelectOutput,
  onSelectStep,
  children,
}: {
  entry: OutputEntry;
  entries: readonly OutputEntry[];
  periods: readonly number[];
  period: number;
  builds: readonly TimelineBuild[];
  marks: readonly BuildMark[][];
  names: ReadonlyMap<string, string>;
  presentation: PanelPresentation;
  scale: ChartScale;
  stepIndex: number | null;
  onScale: (scale: ChartScale) => void;
  onPeriod: (period: number) => void;
  onSelectOutput: (id: string) => void;
  onSelectStep: (index: number) => void;
  /** The open step card, under the chart. */
  children?: ReactNode;
}) {
  const { currency } = presentation;
  const { ref, width } = useElementWidth<HTMLDivElement>(DEFAULT_CHART_WIDTH);
  const layout = useMemo(
    () => chartLayout({ builds, entry, scale, currency, marks, width }),
    [builds, entry, scale, currency, marks, width],
  );
  const latest = latestValue(entry, builds);
  const withValue = entry.values.filter((value, index) => value.value !== null && !builds[index].withdrawn).length;
  const withheld = entry.values.filter((value) => value.status === "withheld").length;
  const official = entry.official;
  const unit = unitName(entry.unit, currency);
  const present = [...new Set(layout.columns.flatMap((column) => column.marks))];
  const modeNote = layout.relative && official !== null
    ? `Each release as a % above or below the official figure, ${formatValue(official, entry.unit, currency)}.`
    : layout.blocked
      ? "No official figure for this output, so it shows values."
      : `Values, ${unit}.`;
  const pickerOptions = entries.map((candidate) => ({ value: candidate.id, label: candidate.label, group: candidate.group }));
  return (
    <article className="grid min-w-0 gap-3.5 rounded-lg border border-border bg-card p-4 shadow-[var(--elev-1)] md:p-[18px]">
      {/* Below the lg breakpoint the navigator gives way to this select. */}
      <div className="flex flex-wrap gap-2 lg:hidden">
        <ToolbarSelect label="Output" value={entry.id} options={pickerOptions} onChange={onSelectOutput} layout="stacked" className="w-full" />
      </div>
      <div>
        <p className="font-mono text-[11.5px] uppercase tracking-[0.05em] text-muted-foreground">{entry.group}</p>
        <h2 className="text-[21px] font-semibold leading-tight tracking-[-0.01em]">{entry.label}</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {periodLabel(entry.period, presentation.periodLabel)} · {unit}
        </p>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Stat label="Latest value" value={latest ? formatValue(latest.value, entry.unit, currency, 2) : "—"} />
        {official !== null && latest && (
          <Stat label="Against official" value={formatPercent(versusOfficial(latest.value, official))} small />
        )}
        <Stat
          label="Step from the build before"
          value={latest ? formatChange(entry.values[latest.index], entry.unit, currency) : "—"}
          small
        />
        <Stat
          label="Builds with a value"
          value={`${withValue} of ${builds.filter((build) => !build.withdrawn).length}${withheld ? ` · ${withheld} withheld` : ""}`}
          small
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="radiogroup" aria-label="Chart values" className="inline-flex rounded-md border border-border p-0.5">
          {SCALES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={scale === option.id}
              onClick={() => onScale(option.id)}
              className={`h-8 rounded px-3 text-sm font-medium transition-colors ${
                scale === option.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {periods.length > 1 && (
          <ToolbarSelect
            label="Period"
            value={String(period)}
            options={periods.map((candidate) => ({ value: String(candidate), label: periodLabel(candidate, presentation.periodLabel) }))}
            onChange={(next) => onPeriod(Number(next))}
          />
        )}
        <p className="min-w-0 text-[12.5px] text-muted-foreground">{modeNote}</p>
      </div>
      <div ref={ref} className="min-w-0">
        <ReleaseHistoryChart
          layout={layout}
          label={`${entry.fullLabel}${layout.relative ? ", as a % above or below its official figure," : ""} across ${builds.length} builds. The table below lists every value.`}
          readout={(index) => columnReadout({ entry, builds, names, currency, relative: layout.relative, index })}
          selectedIndex={stepIndex}
          onSelect={onSelectStep}
        />
      </div>
      <MarkLegend marks={present} />
      <p className="border-t border-border pt-3 text-[13px] text-muted-foreground">
        <span className="font-semibold text-foreground">Official reference: </span>
        {entry.reference?.status === "resolved" && official !== null
          ? `${formatValue(official, entry.unit, currency)}, ${referenceLine(entry)}`
          : referenceLine(entry)}
      </p>
      {children}
      <details className="group border-t border-border pt-2">
        <summary className="cursor-pointer select-none py-1 text-sm font-medium text-foreground">
          <span className="group-open:hidden">Show the table of builds</span>
          <span className="hidden group-open:inline">Hide the table of builds</span>
        </summary>
        <ValuesTable
          entry={entry}
          builds={builds}
          marks={marks}
          names={names}
          currency={currency}
          selectedIndex={stepIndex}
          onSelect={onSelectStep}
        />
      </details>
    </article>
  );
}
