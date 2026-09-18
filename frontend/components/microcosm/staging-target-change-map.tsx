"use client";

import {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  explorerBreadcrumbs,
  explorerEmptyMessage,
  explorerNodeLabel,
  explorerUpLabel,
  hasExplorerFilters,
} from "@/components/microcosm/calibration-explorer-view";
import { CalibrationExplorerFilterMenu } from "@/components/microcosm/calibration-explorer-filter-menu";
import { CalibrationComparisonProvenanceNotices } from "@/components/microcosm/calibration-provenance-notice";
import { MicrocosmTargetDetail } from "@/components/microcosm/microcosm-target-detail";
import { stagingTargetDetailPresentation } from "@/components/microcosm/staging-target-detail-presentation";
import { HelpHint } from "@/components/shared/help-hint";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import {
  useMicrocosmStagingTargetChangeTree,
  type MicrocosmTargetDimension,
  type MicrocosmTargetRow,
} from "@/lib/api/hooks/use-microcosm";
import {
  createExplorerFilters,
  createExplorerState,
  explorerReducer,
} from "@/lib/microcosm/calibration-explorer";
import type {
  CalibrationTreeGroup,
  CalibrationTreeMetrics,
} from "@/lib/microcosm/calibration-tree";
import {
  condenseCalibrationTreemapByMetric,
  expandedGroupsForNode,
  type CalibrationTreemapGroup,
  type CalibrationTreemapNode,
} from "@/lib/microcosm/calibration-treemap-layout";
import type { TargetChangeMode } from "@/lib/microcosm/target-change";
import type { TargetChangeTreeResponse } from "@/lib/microcosm/target-change-tree";
import {
  formatTargetChange,
  targetChangeDirectionAreas,
  targetChangeGroupsForDirection,
  targetChangeDirectionValue,
  type TargetChangeDirection,
  type TargetChangeDirectionData,
} from "@/lib/microcosm/target-change-visualization";
import { squarify, type Placed, type Rect } from "@/lib/treemap/squarify";

const DIRECTION_GAP = 8;
const DIRECTION_HEADER_HEIGHT = 34;
const GROUP_GAP = 7;
const GROUP_HEADER_HEIGHT = 22;
const NODE_GAP = 3;

const MODE_HELP: Record<TargetChangeMode, string> = {
  reported:
    "Uses each release's actual target weights and complete target surface. Added targets contribute candidate error, while removed targets subtract their current-release contribution.",
  shared:
    "Uses only targets present in both releases and applies the same pooled target weights to both. Each release still uses its own verified benchmark, scale, cap, and capped error.",
};

interface LaidGroup {
  group: CalibrationTreemapGroup;
  rect: Placed<CalibrationTreemapGroup>;
  headerHeight: number;
  nodes: Placed<CalibrationTreemapNode>[];
}

interface LaidDirection {
  direction: TargetChangeDirection;
  label: string;
  rect: Rect;
  groups: LaidGroup[];
}

function metricFor(direction: TargetChangeDirection) {
  return (metrics: CalibrationTreeMetrics) =>
    targetChangeDirectionValue(metrics, direction);
}

function insetRect(rect: Rect, gap: number): Rect {
  return {
    x: rect.x + gap / 2,
    y: rect.y + gap / 2,
    w: Math.max(rect.w - gap, 0),
    h: Math.max(rect.h - gap, 0),
  };
}

function layoutGroups(
  groups: CalibrationTreeGroup[],
  direction: TargetChangeDirection,
  rect: Rect,
): LaidGroup[] {
  const metric = metricFor(direction);
  const directionalGroups = targetChangeGroupsForDirection(groups, direction);
  const condensed = condenseCalibrationTreemapByMetric(
    directionalGroups,
    metric,
    rect.w,
    rect.h,
  );
  const placedGroups = squarify(
    condensed
      .map((group) => ({ value: metric(group.metrics), data: group }))
      .filter((entry) => entry.value > 0),
    rect,
  );
  return placedGroups.map((placed) => {
    const groupRect = insetRect(placed, GROUP_GAP);
    const headerHeight =
      !placed.data.synthetic && groupRect.h >= 58 && groupRect.w >= 90
        ? GROUP_HEADER_HEIGHT
        : 0;
    const inner = {
      x: groupRect.x,
      y: groupRect.y + headerHeight,
      w: groupRect.w,
      h: Math.max(groupRect.h - headerHeight, 0),
    };
    const nodes = squarify(
      placed.data.nodes
        .map((node) => ({ value: metric(node.metrics), data: node }))
        .filter((entry) => entry.value > 0),
      inner,
    );
    return {
      group: placed.data,
      rect: { ...placed, ...groupRect },
      headerHeight,
      nodes,
    };
  });
}

function layoutDirections(
  data: TargetChangeTreeResponse,
  width: number,
  height: number,
  expanded: {
    label: string;
    groups: CalibrationTreeGroup[];
    direction: TargetChangeDirection;
  } | null,
): LaidDirection[] {
  const displayedGroups = expanded?.groups ?? data.groups;
  const areas: Array<Placed<TargetChangeDirectionData>> = targetChangeDirectionAreas(
    displayedGroups,
    width,
    height,
  ).filter((area) => !expanded || area.data.direction === expanded.direction);
  return areas.map((area) => {
    const directionRect = insetRect(area, DIRECTION_GAP);
    const contentRect = {
      x: directionRect.x,
      y: directionRect.y + DIRECTION_HEADER_HEIGHT,
      w: directionRect.w,
      h: Math.max(directionRect.h - DIRECTION_HEADER_HEIGHT, 0),
    };
    return {
      direction: area.data.direction,
      label: area.data.label,
      rect: directionRect,
      groups: layoutGroups(
        expanded?.groups ?? data.groups,
        area.data.direction,
        contentRect,
      ),
    };
  });
}

function isTreeResponse(
  data: ReturnType<typeof useMicrocosmStagingTargetChangeTree>["data"],
): data is TargetChangeTreeResponse {
  return Boolean(data && "groups" in data);
}

function Control<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; tooltip?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div
        role="tablist"
        aria-label={label}
        className="flex rounded-lg border border-border bg-muted/40 p-1"
      >
        {options.map((option) => (
          <div
            key={option.value}
            role="presentation"
            className={`flex h-8 items-center rounded-md text-[13px] font-medium ${
              value === option.value
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={value === option.value}
              onClick={() => onChange(option.value)}
              className={`h-full cursor-pointer hover:text-foreground ${
                option.tooltip ? "pl-3 pr-1" : "px-3"
              }`}
            >
              {option.label}
            </button>
            {option.tooltip ? (
              <span className="mr-2 inline-flex">
                <HelpHint
                  label={<span className="sr-only">About {option.label}</span>}
                  tooltip={option.tooltip}
                  interaction="click"
                  underline={false}
                  inheritTypography
                />
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StagingTargetChangeMap({
  runId,
  releaseId,
  weightedTargetErrorChange,
}: {
  runId: string;
  releaseId: string;
  weightedTargetErrorChange: number | null;
}) {
  const [state, dispatch] = useReducer(explorerReducer, undefined, createExplorerState);
  const [mode, setMode] = useState<TargetChangeMode>("reported");
  const [expanded, setExpanded] = useState<{
    label: string;
    groups: CalibrationTreeGroup[];
    direction: TargetChangeDirection;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 520 });
  const { data, isLoading, error } = useMicrocosmStagingTargetChangeTree({
    runId,
    releaseId,
    mode,
    state,
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data]);

  if (isLoading && !data) {
    return <LoadingBlock label="Building target error change map…" height="h-[32rem]" />;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        {error instanceof Error ? error.message : "Target error change is unavailable."}
      </div>
    );
  }
  if (!data || !isTreeResponse(data)) {
    return (
      <div className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        {data?.reason ?? "Target error change is unavailable."}
      </div>
    );
  }
  if (!data.available || !data.summary) {
    return (
      <div className="flex flex-col gap-4">
        <CalibrationComparisonProvenanceNotices
          current={data.current.calibrationProvenance}
          candidate={data.candidate.calibrationProvenance}
        />
        <div className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
          {data.reason ?? "Weighted target-error attribution is unavailable for this comparison."}
        </div>
      </div>
    );
  }

  const directions = layoutDirections(data, size.width, size.height, expanded);
  const breadcrumbs = explorerBreadcrumbs(state, data.pathLabels);
  const upLabel = expanded ? `Up to ${data.currentLevel.label.toLowerCase()}` : explorerUpLabel(state);
  const selectedDetail =
    data.selectedTarget?.candidateDetail ?? data.selectedTarget?.currentDetail ?? null;
  const selectedDetailDimensions: MicrocosmTargetDimension[] = data.dimensionOrder.map(
    (dimension) => ({ ...dimension, values: [] }),
  );
  const selectedDetailPresentation = data.selectedTarget
      ? stagingTargetDetailPresentation(
          data.selectedTarget,
          weightedTargetErrorChange,
          data.selectedTarget.candidateDetail as MicrocosmTargetRow | null,
        )
    : null;
  const filtersActive = hasExplorerFilters(state);
  const filtersExcludeAllTargets = filtersActive && data.filteredMetrics.nTargets === 0;

  return (
    <div className="flex flex-col gap-4">
      <CalibrationComparisonProvenanceNotices
        current={data.current.calibrationProvenance}
        candidate={data.candidate.calibrationProvenance}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Control
            label="Comparison"
            value={mode}
            options={[
              {
                value: "reported",
                label: "Reported error change",
                tooltip: MODE_HELP.reported,
              },
              {
                value: "shared",
                label: "Shared-target comparison",
                tooltip: MODE_HELP.shared,
              },
            ]}
            onChange={(nextMode) => {
              setExpanded(null);
              dispatch({ type: "clear_target" });
              setMode(nextMode);
            }}
          />
          <Control
            label="Breakdown"
            value={state.breakdown}
            options={[
              { value: "program", label: "Program" },
              { value: "geography", label: "Geography" },
            ]}
            onChange={(breakdown) => {
              setExpanded(null);
              dispatch({ type: "breakdown", breakdown });
            }}
          />
          <CalibrationExplorerFilterMenu
            data={data}
            state={state}
            onFilters={(filters) => {
              setExpanded(null);
              dispatch({ type: "filters", filters });
            }}
          />
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3 text-xs">
        {upLabel ? (
          <button
            type="button"
            onClick={() => {
              if (expanded) setExpanded(null);
              else dispatch({ type: "up" });
            }}
            className="max-w-[40%] shrink-0 truncate font-medium text-primary hover:underline"
          >
            ← {upLabel}
          </button>
        ) : null}
        <nav aria-label="Target error change location" className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-muted-foreground">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}:${index}`}>
              {index > 0 ? <span className="mx-1">/</span> : null}
              <button
                type="button"
                onClick={() => {
                  setExpanded(null);
                  dispatch({ type: "navigate", path: crumb.path });
                }}
                className="hover:text-foreground hover:underline"
              >
                {crumb.label}
              </button>
            </span>
          ))}
          {expanded ? (
            <span className="font-medium text-foreground">
              <span className="mx-1">/</span>{expanded.label}
            </span>
          ) : null}
        </nav>
      </div>

      <div
        ref={containerRef}
        className="relative min-h-[26rem] w-full overflow-hidden rounded-lg border border-border bg-muted/10"
        style={{ height: "min(620px, 70dvh)" }}
      >
        {directions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <p>
              {filtersExcludeAllTargets
                ? explorerEmptyMessage(state)
                : "No weighted target-error changes exceed the display tolerance at this level."}
            </p>
            {filtersActive ? (
              <button
                type="button"
                onClick={() =>
                  dispatch({ type: "filters", filters: createExplorerFilters() })
                }
                className="cursor-pointer font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : directions.map((direction) => {
          const directionSign = direction.direction === "increase" ? 1 : -1;
          const tone = direction.direction === "increase" ? "var(--neg)" : "var(--pos)";
          return (
            <div key={direction.direction}>
              <div
                className="absolute overflow-hidden rounded-md border border-border/80"
                style={{
                  left: direction.rect.x,
                  top: direction.rect.y,
                  width: direction.rect.w,
                  height: direction.rect.h,
                  background: `color-mix(in srgb, ${tone} 5%, var(--card))`,
                }}
              />
              <div
                className={`absolute truncate px-2 py-2 text-xs font-semibold ${
                  direction.direction === "increase" ? "tone-neg" : "tone-pos"
                }`}
                style={{
                  left: direction.rect.x,
                  top: direction.rect.y,
                  width: direction.rect.w,
                  height: DIRECTION_HEADER_HEIGHT,
                }}
                title={direction.label}
              >
                {direction.label}
              </div>
              {direction.groups.map(({ group, rect, headerHeight, nodes }) => (
                <div key={`${direction.direction}:${group.id}`}>
                  {headerHeight > 0 ? (
                    <div
                      className="absolute flex items-baseline gap-2 overflow-hidden px-1"
                      style={{ left: rect.x, top: rect.y, width: rect.w, height: headerHeight }}
                    >
                      <span className="truncate text-[11px] font-semibold text-foreground">{group.label}</span>
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {formatTargetChange(directionSign * targetChangeDirectionValue(group.metrics, direction.direction), false)}
                      </span>
                    </div>
                  ) : null}
                  {nodes.map((placed) => {
                    const item = placed.data;
                    const tile = insetRect(placed, NODE_GAP);
                    if (tile.w < 2 || tile.h < 2) return null;
                    const itemLabel = item.kind === "grouped"
                      ? item.label
                      : explorerNodeLabel({ id: item.id, kind: item.kind, label: item.label });
                    const value = targetChangeDirectionValue(item.metrics, direction.direction);
                    const showLabel = tile.w >= 44 && tile.h >= 24;
                    const showValue = tile.w >= 72 && tile.h >= 48;
                    const selected = item.kind === "target" && item.id === state.path.target;
                    return (
                      <button
                        key={`${direction.direction}:${group.id}:${item.id}`}
                        type="button"
                        title={`${itemLabel} · ${formatTargetChange(directionSign * value, false)}`}
                        aria-label={`${itemLabel}, ${formatTargetChange(directionSign * value, false)}`}
                        aria-pressed={selected}
                        onClick={() => {
                          const expandedGroups = expandedGroupsForNode(item);
                          if (expandedGroups) {
                            setExpanded({
                              label: item.label,
                              groups: expandedGroups,
                              direction: direction.direction,
                            });
                          } else if (item.selection) {
                            setExpanded(null);
                            dispatch({ type: "select", selection: item.selection });
                          }
                        }}
                        className="absolute cursor-pointer overflow-hidden px-1.5 py-1.5 text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                        style={{
                          left: tile.x,
                          top: tile.y,
                          width: tile.w,
                          height: tile.h,
                          borderRadius: Math.max(2, Math.min(6, Math.min(tile.w, tile.h) * 0.25)),
                          background: `color-mix(in srgb, ${tone} 20%, var(--card))`,
                          boxShadow: selected
                            ? "0 0 0 2px var(--card), 0 0 0 4px var(--chart-1)"
                            : "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent)",
                        }}
                      >
                        {showLabel ? <span className="line-clamp-3 text-[11px] font-semibold leading-tight">{itemLabel}</span> : null}
                        {showValue ? (
                          <span className="mt-1 block truncate text-[10px] opacity-75">
                            {formatTargetChange(directionSign * value, false)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Area shows each category's absolute net change in weighted target error at the current level. Each category appears once, on the side determined by its net change. Select a category to drill down or select a target to compare its values directly.
      </p>

      {data.selectedTarget && selectedDetail ? (
        <MicrocosmTargetDetail
          row={selectedDetail as MicrocosmTargetRow}
          dimensions={selectedDetailDimensions}
          eyebrow={
            data.selectedTarget.candidateDetail
              ? "Candidate calibration target"
              : "Current release calibration target"
          }
          metrics={selectedDetailPresentation?.metrics}
          afterCalibrationSeries={selectedDetailPresentation?.afterCalibrationSeries}
          fitSummary={selectedDetailPresentation?.fitSummary}
          onClose={() => dispatch({ type: "clear_target" })}
        />
      ) : null}
    </div>
  );
}
