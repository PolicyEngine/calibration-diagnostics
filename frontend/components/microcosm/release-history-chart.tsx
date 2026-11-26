"use client";

import { useEffect, useRef, useState } from "react";

import {
  BUILD_MARK_LABELS,
  type BuildMark,
} from "@/lib/microcosm/release-history-builds";
import type { ChartColumn, ChartLayout } from "@/lib/microcosm/release-history-chart";

// The release history chart (calibration-diagnostics#224): one output across the builds of a
// series. The layout is computed by lib/microcosm/release-history-chart.ts; this draws it.
//
// One series in the dashboard's one hue. A column with no value is shaded and labelled, so no
// state is told by colour alone, and every value is also in the table under the chart. Each
// column is a button over the plot: hover or focus shows its values, a click opens its step.

/** What the tooltip and a column's accessible name say about one build. */
export interface ChartColumnReadout {
  /** The build's date and name. */
  title: string;
  /** The value as the chart places it, or why the column holds none. */
  value: string;
  /** The value's other reading: beside the official figure, or in its unit. */
  detail: string | null;
  /** The step from the build before, or why there is none. */
  step: string;
}

export const DEFAULT_CHART_WIDTH = 760;

/** The width of an element, followed as it resizes; `fallback` before it is measured. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = Math.round(element.clientWidth);
      if (next > 0) setWidth((current) => (Math.abs(current - next) < 2 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const INK = "var(--text-secondary)";

function sentenceCase(text: string): string {
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

/** A mark's glyph, centred on (x, y): a diamond, two bars, or a cross. */
export function MarkGlyph({ mark, x, y }: { mark: BuildMark; x: number; y: number }) {
  if (mark === "new_build_engine") {
    return <path d={`M${x} ${y - 4.5}L${x + 4.5} ${y}L${x} ${y + 4.5}L${x - 4.5} ${y}Z`} fill={INK} />;
  }
  if (mark === "same_file") {
    return (
      <path
        d={`M${x - 4} ${y - 2}H${x + 4}M${x - 4} ${y + 2}H${x + 4}`}
        stroke={INK}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    );
  }
  return (
    <path
      d={`M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}`}
      stroke={INK}
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
    />
  );
}

/** The marks a chart carries, each with its glyph and what it means. */
export function MarkLegend({ marks }: { marks: readonly BuildMark[] }) {
  if (marks.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label="Marks under the axis">
      {marks.map((mark) => (
        <li key={mark} className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <MarkGlyph mark={mark} x={6} y={6} />
          </svg>
          {BUILD_MARK_LABELS[mark]}
        </li>
      ))}
    </ul>
  );
}

function Bands({ layout }: { layout: ChartLayout }) {
  const { plot } = layout;
  return (
    <>
      {layout.columns.map((column) => {
        if (!column.band) return null;
        const inset = Math.min(3, column.width / 4);
        return (
          <g key={column.buildId}>
            <rect
              x={column.left + inset}
              y={plot.top}
              width={Math.max(column.width - 2 * inset, 2)}
              height={plot.bottom - plot.top}
              fill="var(--section)"
            />
            {layout.verticalBandLabels ? (
              <text
                transform={`translate(${column.x + 3.5} ${plot.top + 8}) rotate(-90)`}
                textAnchor="end"
                className="fill-muted-foreground text-[10.5px]"
              >
                {sentenceCase(column.band)}
              </text>
            ) : (
              <text x={column.x} y={plot.top + 14} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">
                {sentenceCase(column.band)}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

function Scale({ layout }: { layout: ChartLayout }) {
  const { plot } = layout;
  return (
    <>
      {layout.ticks.map((tick, index) => (
        <g key={index}>
          <line x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} stroke="var(--border-soft)" strokeWidth="1" />
          <text x={plot.left - 8} y={tick.y + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
            {tick.label}
          </text>
        </g>
      ))}
      {layout.official && (
        <g>
          <line x1={plot.left} x2={plot.right} y1={layout.official.y} y2={layout.official.y} stroke={INK} strokeWidth="1" />
          <text x={plot.right} y={layout.official.y - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
            {layout.official.label}
          </text>
        </g>
      )}
      <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke="var(--border-strong)" strokeWidth="1" />
    </>
  );
}

function Series({ layout }: { layout: ChartLayout }) {
  return (
    <>
      {layout.segments.map((segment) => (
        <line
          key={`${segment.from}-${segment.to}`}
          x1={segment.x1}
          y1={segment.y1}
          x2={segment.x2}
          y2={segment.y2}
          stroke="var(--chart-1)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {layout.columns.map((column) => {
        if (!column.point) return null;
        // A ring in the card's colour keeps a marker legible where it sits on the line. A
        // withdrawn build's value is hollow: it is shown, and it is on no line.
        return column.point.hollow ? (
          <circle key={column.buildId} cx={column.x} cy={column.point.y} r="4" fill="var(--card)" stroke="var(--chart-1)" strokeWidth="2" />
        ) : (
          <circle
            key={column.buildId}
            cx={column.x}
            cy={column.point.y}
            r={column.current ? 5.5 : 4.5}
            fill="var(--chart-1)"
            stroke="var(--card)"
            strokeWidth="2"
          />
        );
      })}
      {layout.latestLabel && (
        <text
          x={layout.latestLabel.x}
          y={layout.latestLabel.y}
          textAnchor={layout.latestLabel.anchor}
          className="fill-foreground text-[11px] font-medium tabular-nums"
        >
          {layout.latestLabel.text}
        </text>
      )}
    </>
  );
}

function Axis({ layout }: { layout: ChartLayout }) {
  const { plot } = layout;
  return (
    <>
      {layout.columns.map((column) => (
        <g key={column.buildId}>
          {column.marks.map((mark, index) => (
            <MarkGlyph
              key={mark}
              mark={mark}
              x={column.x + (index - (column.marks.length - 1) / 2) * 12}
              y={plot.bottom + 12}
            />
          ))}
          {column.dateLabel && (
            <text
              x={column.x}
              y={plot.bottom + 34}
              textAnchor="middle"
              className={`text-[11px] ${column.current ? "fill-foreground font-medium" : "fill-muted-foreground"}`}
            >
              {column.dateLabel}
            </text>
          )}
          {column.current && (
            <text x={column.x} y={plot.bottom + 49} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
              Current
            </text>
          )}
        </g>
      ))}
    </>
  );
}

function Tooltip({ layout, column, readout }: { layout: ChartLayout; column: ChartColumn; readout: ChartColumnReadout }) {
  // Beside its column, so the value it reads out stays in view: to the right where it fits,
  // otherwise to the left, and never outside the chart.
  const width = 232;
  const gap = 14;
  const right = column.x + gap;
  const left = Math.max(right + width <= layout.width ? right : column.x - gap - width, 0);
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-1 z-10 grid gap-0.5 rounded-md border border-border-dark bg-popover px-2.5 py-2 text-xs shadow-lg"
      style={{ left, width }}
    >
      <span className="text-[15px] font-semibold tabular-nums text-foreground">{readout.value}</span>
      {readout.detail && <span className="text-muted-foreground">{readout.detail}</span>}
      <span className="break-words font-mono text-[11px] text-muted-foreground">{readout.title}</span>
      <span className="text-muted-foreground">{readout.step}</span>
    </div>
  );
}

export function ReleaseHistoryChart({
  layout,
  label,
  readout,
  selectedIndex,
  onSelect,
}: {
  layout: ChartLayout;
  /** What the chart shows, for a reader who cannot see it. */
  label: string;
  readout: (index: number) => ChartColumnReadout;
  /** The build whose step card is open. */
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  const [active, setActive] = useState<number | null>(null);
  const { plot } = layout;
  const activeColumn = active === null ? null : layout.columns[active] ?? null;
  const selected = selectedIndex === null ? null : layout.columns[selectedIndex] ?? null;
  return (
    <div className="relative" style={{ height: layout.height }}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={label}
        className="block max-w-full font-mono"
      >
        <Bands layout={layout} />
        {selected && (
          <rect
            x={selected.left + 1}
            y={plot.top}
            width={Math.max(selected.width - 2, 2)}
            height={plot.bottom - plot.top}
            fill="var(--accent-subtle)"
            fillOpacity="0.6"
            stroke="var(--accent)"
            strokeWidth="1"
          />
        )}
        <Scale layout={layout} />
        {layout.empty && (
          <text
            x={(plot.left + plot.right) / 2}
            y={(plot.top + plot.bottom) / 2}
            textAnchor="middle"
            className="fill-muted-foreground text-[12px]"
          >
            No build holds a value for this output.
          </text>
        )}
        {activeColumn && (
          <line x1={activeColumn.x} x2={activeColumn.x} y1={plot.top} y2={plot.bottom} stroke="var(--text-tertiary)" strokeWidth="1" />
        )}
        <Series layout={layout} />
        <Axis layout={layout} />
      </svg>
      {/* One button per column: the hover and focus target, wider than any mark. */}
      {layout.columns.map((column) => {
        const said = readout(column.index);
        return (
          <button
            key={column.buildId}
            type="button"
            aria-label={`${said.title}: ${said.value}${said.detail ? `, ${said.detail}` : ""}. ${said.step}`}
            aria-pressed={selectedIndex === column.index}
            className="absolute cursor-pointer rounded-sm bg-transparent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            style={{ left: column.left, width: column.width, top: plot.top, height: plot.bottom - plot.top + 54 }}
            onPointerEnter={() => setActive(column.index)}
            onPointerLeave={() => setActive((current) => (current === column.index ? null : current))}
            onFocus={() => setActive(column.index)}
            onBlur={() => setActive((current) => (current === column.index ? null : current))}
            onClick={() => onSelect(column.index)}
          />
        );
      })}
      {activeColumn && <Tooltip layout={layout} column={activeColumn} readout={readout(activeColumn.index)} />}
    </div>
  );
}

/** A small line of one output's values, drawn from a path the layout computed. */
export function Sparkline({ path, last }: { path: string; last: { x: number; y: number } | null }) {
  return (
    <svg width="56" height="18" viewBox="0 0 56 18" aria-hidden="true" className="block shrink-0">
      {path && (
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {last && <circle cx={last.x} cy={last.y} r="2.2" fill="var(--chart-1)" />}
    </svg>
  );
}
