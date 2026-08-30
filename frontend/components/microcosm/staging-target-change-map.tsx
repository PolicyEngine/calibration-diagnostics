"use client";

import {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  explorerBreadcrumbs,
  explorerNodeLabel,
  explorerUpLabel,
} from "@/components/microcosm/calibration-explorer-view";
import { fmt } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { StatusPill } from "@/components/shared/status-pill";
import { useMicrocosmStagingTargetChangeTree } from "@/lib/api/hooks/use-microcosm";
import {
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
import type {
  TargetChangeMode,
  TargetChangeRow,
} from "@/lib/microcosm/target-change";
import type { TargetChangeTreeResponse } from "@/lib/microcosm/target-change-tree";
import {
  targetMatchKindExplanation,
  targetRepresentationPairLabel,
} from "@/lib/microcosm/target-matching-presentation";
import {
  formatTargetChange,
  formatWeightedTargetError,
  targetChangeDetailValues,
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

function targetStatus(target: TargetChangeRow) {
  if (target.comparison_status === "added") {
    return <StatusPill tone="info">Added target</StatusPill>;
  }
  if (target.comparison_status === "removed") {
    return <StatusPill tone="warning">Removed target</StatusPill>;
  }
  return <StatusPill tone="neutral">Shared target</StatusPill>;
}

function nullableNumber(value: number | null | undefined): string {
  return value == null ? "—" : fmt(value, { digits: 2 });
}

function nullablePercent(value: number | null | undefined): string {
  return value == null ? "—" : formatWeightedTargetError(value);
}

function TargetChangeDetail({
  target,
  mode,
  onClose,
}: {
  target: TargetChangeRow;
  mode: TargetChangeMode;
  onClose: () => void;
}) {
  const detail = targetChangeDetailValues(target, mode);
  const rows = [
    {
      label: "Target identifier",
      current: target.current_name ?? "—",
      candidate: target.candidate_name ?? "—",
    },
    {
      label: "Benchmark",
      current: nullableNumber(target.current?.target),
      candidate: nullableNumber(target.candidate?.target),
    },
    {
      label: "Final estimate",
      current: nullableNumber(target.current?.finalEstimate),
      candidate: nullableNumber(target.candidate?.finalEstimate),
    },
    {
      label: "Artifact target weight",
      current: nullablePercent(detail.currentWeightShare),
      candidate: nullablePercent(detail.candidateWeightShare),
    },
    {
      label: "Capped scaled error",
      current: nullablePercent(target.current?.cappedError),
      candidate: nullablePercent(target.candidate?.cappedError),
    },
    {
      label: mode === "reported" ? "Weighted error contribution" : "Pooled-weight contribution",
      current: nullablePercent(detail.currentContribution),
      candidate: nullablePercent(detail.candidateContribution),
    },
  ];
  return (
    <div className="rounded-lg border border-border bg-card shadow-[var(--elev-2)]">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-foreground">
              {String(target.variable ?? target.name)}
            </h4>
            {targetStatus(target)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {targetRepresentationPairLabel(
              target.current_representation,
              target.candidate_representation,
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          Close
        </button>
      </div>
      {mode === "shared" && detail.comparisonWeight != null ? (
        <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
          Shared comparison weight: {formatWeightedTargetError(detail.comparisonWeight)} on both sides.
        </div>
      ) : null}
      {target.match_kind ? (
        <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
          {targetMatchKindExplanation(target.match_kind)}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-semibold">Value</th>
              <th className="px-4 py-2 text-right font-semibold">Current release</th>
              <th className="px-4 py-2 text-right font-semibold">Candidate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border/50 last:border-b-0">
                <td className="px-4 py-2 font-medium">{row.label}</td>
                <td className="max-w-[18rem] break-all px-4 py-2 text-right tabular-nums text-muted-foreground">{row.current}</td>
                <td className="max-w-[18rem] break-all px-4 py-2 text-right tabular-nums">{row.candidate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2 text-xs">
        <span className="font-medium">Selected-mode change</span>
        <span className={
          (detail.change ?? 0) > 0
            ? "font-semibold tabular-nums tone-neg"
            : (detail.change ?? 0) < 0
              ? "font-semibold tabular-nums tone-pos"
              : "font-semibold tabular-nums text-muted-foreground"
        }>
          {formatTargetChange(detail.change)}
        </span>
      </div>
      {target.comparison_status === "removed" ? (
        <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
          Removing this target lowers the reported aggregate mechanically. It does not show that the candidate fits this target better.
        </p>
      ) : null}
    </div>
  );
}

export function StagingTargetChangeMap({
  runId,
  releaseId,
}: {
  runId: string;
  releaseId: string;
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
      <div className="rounded-lg border border-border p-5 text-sm text-muted-foreground">
        {data.reason ?? "Weighted target-error attribution is unavailable for this comparison."}
      </div>
    );
  }

  const directions = layoutDirections(data, size.width, size.height, expanded);
  const breadcrumbs = explorerBreadcrumbs(state);
  const upLabel = expanded ? `Up to ${data.currentLevel.label.toLowerCase()}` : explorerUpLabel(state);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-3">
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
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No weighted target-error changes exceed the display tolerance at this level.
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

      {data.selectedTarget ? (
        <TargetChangeDetail
          target={data.selectedTarget}
          mode={mode}
          onClose={() => dispatch({ type: "clear_target" })}
        />
      ) : null}
    </div>
  );
}
