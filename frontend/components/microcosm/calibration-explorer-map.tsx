"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  EXPLORER_MAP_VERTICAL_PADDING,
  explorerBreadcrumbs,
  explorerEmptyMessage,
  explorerMapHeight,
  explorerNodeLabel,
  explorerSizePhrase,
  explorerUpLabel,
  hasExplorerFilters,
} from "@/components/microcosm/calibration-explorer-view";
import { MicrocosmTargetDetail } from "@/components/microcosm/microcosm-target-detail";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { fmt, humanizeName } from "@/components/shared/format";
import {
  useMicrocosmCalibrationTree,
  type MicrocosmTargetDimension,
  type MicrocosmTargetRow,
} from "@/lib/api/hooks/use-microcosm";
import {
  createExplorerState,
  explorerReducer,
  type ExplorerBreakdown,
  type ExplorerFilters,
  type ExplorerState,
} from "@/lib/microcosm/calibration-explorer";
import {
  MISSING_VALUE,
  effectiveNodeMetric,
  type CalibrationTreeGroup,
  type CalibrationTreeNode,
  type CalibrationTreeResponse,
  type CalibrationTreeSizeMode,
} from "@/lib/microcosm/calibration-tree";
import { FIT_LEGEND, fitColor, readableInk } from "@/lib/treemap/fit-scale";
import { squarify, type Placed } from "@/lib/treemap/squarify";

const GROUP_GAP = 8;
const NODE_GAP = 3;
const HEADER_HEIGHT = 24;

const FIT_LABELS: Record<string, string> = {
  "0_5": "0–5%",
  "5_10": "5–10%",
  "10_20": "10–20%",
  "20_40": "20–40%",
  "40_plus": "40%+",
  unscored: "Unscored",
};

const STATUS_LABELS: Record<string, string> = {
  included: "Included",
  skipped: "Skipped",
  not_materialized: "Not materialized",
};

function stackedElementHeight(elements: HTMLElement[]): number {
  return elements.reduce((height, element, index) => {
    const elementHeight = element.getBoundingClientRect().height;
    if (index === 0) return elementHeight;

    const previous = elements[index - 1];
    const sameParent = previous.parentElement === element.parentElement;
    const gap = sameParent && element.parentElement
      ? Number.parseFloat(getComputedStyle(element.parentElement).rowGap) || 0
      : 0;
    const previousMargin =
      Number.parseFloat(getComputedStyle(previous).marginBottom) || 0;
    const nextMargin =
      Number.parseFloat(getComputedStyle(element).marginTop) || 0;
    return height + gap + previousMargin + nextMargin + elementHeight;
  }, 0);
}

function displayValue(value: string): string {
  if (value === MISSING_VALUE) return "Not specified";
  return humanizeName(value) || value;
}

function metricValue(
  metrics: CalibrationTreeNode["metrics"],
  mode: CalibrationTreeSizeMode,
): number {
  if (mode === "targets") return metrics.nTargets;
  if (mode === "loss") return metrics.loss;
  return metrics.huberErrorIntensity ?? 0;
}

interface LaidGroup {
  group: CalibrationTreeGroup;
  rect: Placed<CalibrationTreeGroup>;
  headerHeight: number;
  nodes: Placed<CalibrationTreeNode>[];
}

function layoutTree(
  groups: CalibrationTreeGroup[],
  mode: CalibrationTreeSizeMode,
  width: number,
  height: number,
): LaidGroup[] {
  let groupValues = groups.map((group) => metricValue(group.metrics, mode));
  if (!groupValues.some((value) => value > 0)) {
    groupValues = groups.map((group) => group.metrics.nTargets);
  }
  const placedGroups = squarify(
    groups
      .map((group, index) => ({ value: groupValues[index], data: group }))
      .filter((entry) => entry.value > 0),
    { x: 0, y: 0, w: width, h: height },
  );

  return placedGroups.map((rect) => {
    const inset = {
      x: rect.x + GROUP_GAP / 2,
      y: rect.y + GROUP_GAP / 2,
      w: Math.max(rect.w - GROUP_GAP, 0),
      h: Math.max(rect.h - GROUP_GAP, 0),
    };
    const headerHeight = inset.h >= 64 && inset.w >= 90 ? HEADER_HEIGHT : 0;
    const inner = {
      x: inset.x,
      y: inset.y + headerHeight,
      w: inset.w,
      h: Math.max(inset.h - headerHeight, 0),
    };
    const weights = effectiveNodeMetric(rect.data.nodes, mode);
    const nodes = squarify(
      rect.data.nodes
        .map((item, index) => ({ value: weights[index], data: item }))
        .filter((entry) => entry.value > 0),
      inner,
    );
    return {
      group: rect.data,
      rect: { ...rect, ...inset },
      headerHeight,
      nodes,
    };
  });
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div role="tablist" aria-label={label} className="flex rounded-lg border border-border bg-muted/40 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={value === option.value}
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-md px-3 text-[13px] font-medium ${
              value === option.value
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BreakdownControl({
  value,
  onChange,
}: {
  value: ExplorerBreakdown;
  onChange: (value: ExplorerBreakdown) => void;
}) {
  return (
    <SegmentedControl
      label="Breakdown"
      value={value}
      onChange={onChange}
      options={[
        { value: "program", label: "Program" },
        { value: "geography", label: "Geography" },
      ]}
    />
  );
}

function SizeControl({
  value,
  onChange,
}: {
  value: CalibrationTreeSizeMode;
  onChange: (value: CalibrationTreeSizeMode) => void;
}) {
  return (
    <SegmentedControl
      label="Size boxes by"
      value={value}
      onChange={onChange}
      options={[
        { value: "targets", label: "Target count" },
        { value: "loss", label: "Loss sources" },
        { value: "error_intensity", label: "Error intensity" },
      ]}
    />
  );
}

function FitLegend() {
  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide">Median error</span>
      <div>
        <div
          className="h-2 w-36 rounded-full ring-1 ring-border/60"
          style={{
            background: `linear-gradient(to right, ${FIT_LEGEND.map((stop) => fitColor(stop.error)).join(", ")})`,
          }}
        />
        <div className="mt-1 flex w-36 justify-between font-mono text-[9px]">
          {FIT_LEGEND.map((stop) => <span key={stop.label}>{stop.label}</span>)}
        </div>
      </div>
    </div>
  );
}

function MultiSelectFilter({
  label,
  options,
  selected,
  labelOf = displayValue,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  labelOf?: (value: string) => string;
  onChange: (values: string[]) => void;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
        {label}{selected.length ? ` · ${selected.length}` : " · All"} ▾
      </summary>
      <div className="absolute left-0 top-full z-40 mt-1 max-h-64 min-w-56 overflow-auto rounded-lg border border-border bg-card p-2 shadow-xl">
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() =>
                onChange(
                  selected.includes(option)
                    ? selected.filter((value) => value !== option)
                    : [...selected, option],
                )
              }
            />
            <span>{labelOf(option)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function FilterBar({
  data,
  state,
  onFilters,
}: {
  data: CalibrationTreeResponse;
  state: ExplorerState;
  onFilters: (filters: ExplorerFilters) => void;
}) {
  const filter = <K extends keyof ExplorerFilters>(key: K, values: ExplorerFilters[K]) =>
    onFilters({ ...state.filters, [key]: values });
  const active = [
    ...state.filters.geographyLevels.map((value) => ({ key: "geographyLevels" as const, value, label: `Level: ${displayValue(value)}` })),
    ...state.filters.geographies.map((value) => ({ key: "geographies" as const, value, label: `Place: ${displayValue(value)}` })),
    ...state.filters.fitBands.map((value) => ({ key: "fitBands" as const, value, label: `Fit: ${FIT_LABELS[value]}` })),
    ...state.filters.calibrationStatuses.map((value) => ({ key: "calibrationStatuses" as const, value, label: `Status: ${STATUS_LABELS[value]}` })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter
          label="Geography level"
          options={data.filterOptions.geographyLevels}
          selected={state.filters.geographyLevels}
          onChange={(values) => filter("geographyLevels", values)}
        />
        <MultiSelectFilter
          label="Geography"
          options={data.filterOptions.geographies}
          selected={state.filters.geographies}
          onChange={(values) => filter("geographies", values)}
        />
        <MultiSelectFilter
          label="Fit band"
          options={data.filterOptions.fitBands}
          selected={state.filters.fitBands}
          labelOf={(value) => FIT_LABELS[value] ?? value}
          onChange={(values) => filter("fitBands", values as ExplorerFilters["fitBands"])}
        />
        <MultiSelectFilter
          label="Calibration status"
          options={data.filterOptions.calibrationStatuses}
          selected={state.filters.calibrationStatuses}
          labelOf={(value) => STATUS_LABELS[value] ?? displayValue(value)}
          onChange={(values) => filter("calibrationStatuses", values as ExplorerFilters["calibrationStatuses"])}
        />
        {active.length > 0 && (
          <button
            type="button"
            onClick={() => onFilters({ geographyLevels: [], geographies: [], fitBands: [], calibrationStatuses: [] })}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {active.map((item) => (
            <button
              type="button"
              key={`${item.key}:${item.value}`}
              onClick={() =>
                filter(
                  item.key,
                  state.filters[item.key].filter((value) => value !== item.value) as never,
                )
              }
              className="rounded-full border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${item.label} filter`}
            >
              {item.label} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterMenu({
  data,
  state,
  onFilters,
}: {
  data: CalibrationTreeResponse;
  state: ExplorerState;
  onFilters: (filters: ExplorerFilters) => void;
}) {
  const activeCount =
    state.filters.geographyLevels.length +
    state.filters.geographies.length +
    state.filters.fitBands.length +
    state.filters.calibrationStatuses.length;

  return (
    <details className="group relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/40 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>Filters{activeCount ? ` · ${activeCount}` : ""}</span>
        <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 shadow-xl">
        <FilterBar data={data} state={state} onFilters={onFilters} />
      </div>
    </details>
  );
}

export function CalibrationExplorerMap({ release }: { release?: string }) {
  const [state, dispatch] = useReducer(
    explorerReducer,
    undefined,
    createExplorerState,
  );
  const { data, isLoading, error } = useMicrocosmCalibrationTree(state, release);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const [height, setHeight] = useState(680);
  const [viewportHeight, setViewportHeight] = useState(680);
  const [sizeMode, setSizeMode] = useState<CalibrationTreeSizeMode>("targets");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const navbar = document.querySelector<HTMLElement>(".site-nav");
    const introductionParts = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-page-introduction-part]",
      ),
    ];
    const updateSize = () => {
      const elementRect = element.getBoundingClientRect();
      const nextWidth = elementRect.width;
      if (nextWidth) setWidth(Math.round(nextWidth));
      if (elementRect.height) setHeight(Math.round(elementRect.height));

      const navbarHeight = navbar?.getBoundingClientRect().height ?? 0;
      const introductionHeight = stackedElementHeight(introductionParts);
      setViewportHeight(
        explorerMapHeight(
          window.innerHeight,
          navbarHeight,
          introductionHeight,
        ),
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    if (navbar) observer.observe(navbar);
    introductionParts.forEach((part) => observer.observe(part));
    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  // The map container is not mounted during the initial loading state. Re-run
  // when query data arrives so the observer attaches to the real element.
  }, [data]);

  if (isLoading && !data) return <LoadingBlock label="Building calibration map…" />;
  if (error || !data) {
    return (
      <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Calibration map unavailable."}
      </div>
    );
  }

  const laidGroups = layoutTree(data.groups, sizeMode, width, height);
  const upLabel = explorerUpLabel(state);
  const breadcrumbs = explorerBreadcrumbs(state);
  const selectedTarget = data.groups
    .flatMap((group) => group.nodes)
    .find((item) => item.kind === "target" && item.id === state.path.target)?.target;
  const detailDimensions: MicrocosmTargetDimension[] = data.dimensionOrder.map((dimension) => ({
    ...dimension,
    values: [],
  }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <BreakdownControl
            value={state.breakdown}
            onChange={(breakdown) => dispatch({ type: "breakdown", breakdown })}
          />
          <SizeControl value={sizeMode} onChange={setSizeMode} />
          <FilterMenu
            data={data}
            state={state}
            onFilters={(filters) => dispatch({ type: "filters", filters })}
          />
        </div>
        <div className="ml-auto shrink-0">
          <FitLegend />
        </div>
      </div>

      <div
        className="flex min-h-0 flex-col gap-3"
        style={{
          height: viewportHeight,
          paddingBlock: EXPLORER_MAP_VERTICAL_PADDING,
        }}
      >
        <div className="flex shrink-0 items-center gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {upLabel && (
              <button
                type="button"
                title={upLabel}
                onClick={() => dispatch({ type: "up" })}
                className="block max-w-[40%] shrink-0 truncate whitespace-nowrap text-xs font-medium text-primary hover:underline"
              >
                ← {upLabel}
              </button>
            )}
            <nav aria-label="Calibration map location" className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-muted-foreground">
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.label}:${index}`}>
                  {index > 0 && <span className="mx-1">/</span>}
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "navigate", path: crumb.path })}
                    aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
                    className={`${index === breadcrumbs.length - 1 ? "font-medium text-foreground" : "hover:text-foreground hover:underline"}`}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
            </nav>
          </div>
        </div>

        <div ref={containerRef} className="relative min-h-0 w-full flex-1">
        {laidGroups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/10 px-6 text-center">
            <p className="text-sm text-muted-foreground">{explorerEmptyMessage(state)}</p>
            {hasExplorerFilters(state) && (
              <button
                type="button"
                onClick={() => dispatch({
                  type: "filters",
                  filters: { geographyLevels: [], geographies: [], fitBands: [], calibrationStatuses: [] },
                })}
                className="text-sm font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          laidGroups.map(({ group, rect, headerHeight, nodes }) => (
            <div key={group.id}>
              {headerHeight > 0 && (
                <div className="absolute flex items-baseline gap-2 overflow-hidden" style={{ left: rect.x, top: rect.y, width: rect.w, height: headerHeight }}>
                  <span className="truncate text-xs font-semibold text-foreground">{group.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{fmt(group.metrics.nTargets, { digits: 0 })}</span>
                </div>
              )}
              {nodes.map((placed) => {
                const item = placed.data;
                const itemLabel = explorerNodeLabel(item);
                const tileWidth = Math.max(placed.w - NODE_GAP, 0);
                const tileHeight = Math.max(placed.h - NODE_GAP, 0);
                if (tileWidth < 2 || tileHeight < 2) return null;
                const color = fitColor(item.metrics.medianAbsRelativeError);
                const ink = readableInk(item.metrics.medianAbsRelativeError);
                const showText = tileWidth >= 44 && tileHeight >= 24;
                const showSub = tileWidth >= 70 && tileHeight >= 46;
                const selected = item.kind === "target" && item.id === state.path.target;
                return (
                  <button
                    key={`${group.id}:${item.id}`}
                    type="button"
                    title={`${itemLabel} · ${item.metrics.nTargets} targets`}
                    aria-label={`${itemLabel}, ${item.metrics.nTargets} targets`}
                    aria-pressed={selected}
                    onClick={() => dispatch({ type: "select", selection: item.selection })}
                    className="absolute overflow-hidden px-1.5 py-1.5 text-left outline-none transition-transform focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                    style={{
                      left: placed.x + NODE_GAP / 2,
                      top: placed.y + NODE_GAP / 2,
                      width: tileWidth,
                      height: tileHeight,
                      borderRadius: Math.max(1.5, Math.min(6, Math.min(tileWidth, tileHeight) * 0.3)),
                      background: color,
                      color: ink,
                      boxShadow: selected ? "0 0 0 2px var(--card), 0 0 0 4px var(--chart-1)" : "inset 0 0 0 1px color-mix(in srgb, var(--background) 6%, transparent)",
                    }}
                  >
                    {showText && <span className="line-clamp-3 text-[11px] font-semibold leading-tight">{itemLabel}</span>}
                    {showSub && <span className="mt-1 block truncate text-[10px] opacity-75">{fmt(item.metrics.nTargets, { digits: 0 })} targets</span>}
                  </button>
                );
              })}
            </div>
          ))
        )}
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Each tile is a group of calibration targets. Area shows{" "}
        <span className="font-medium text-foreground">
          {explorerSizePhrase(sizeMode)}
        </span>
        ; color shows the median gap between the weighted data and the official
        figure. Error intensity is a Huberized per-target relative error: it
        behaves like RMSE for ordinary misses, then grows linearly for extreme
        outliers so one pathological target does not dominate the map. Hover for
        detail, click a tile to pop out its targets.
      </p>

      {selectedTarget && (
        <MicrocosmTargetDetail
          row={selectedTarget as MicrocosmTargetRow}
          dimensions={detailDimensions}
          onClose={() => dispatch({ type: "clear_target" })}
        />
      )}
    </div>
  );
}
