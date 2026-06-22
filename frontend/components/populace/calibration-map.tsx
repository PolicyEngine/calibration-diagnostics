"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ClusterDetail } from "@/components/populace/cluster-detail";
import { fmt, humanizeName } from "@/components/shared/format";
import { FIT_LEGEND, fitColor, readableInk } from "@/lib/treemap/fit-scale";
import { squarify, type Placed } from "@/lib/treemap/squarify";
import type {
  PopulaceTreemapGroup,
  PopulaceTreemapLeaf,
  PopulaceTreemapResponse,
} from "@/lib/api/hooks/use-populace";

type SizeMode = "targets" | "loss";

const GROUP_GAP = 8;
const LEAF_GAP = 3;
const HEADER_H = 22;
// Tiles whose projected area falls below these (≈ a 50px and 28px square) get
// rolled into an "Other" tile so the map never devolves into unreadable confetti.
const MIN_GROUP_AREA = 2600;
const MIN_LEAF_AREA = 780;
const OTHER_SOURCES_KEY = "__other_sources__";

function metric(node: { n_targets: number; loss: number }, mode: SizeMode): number {
  return mode === "targets" ? node.n_targets : node.loss;
}

function isSynthetic(key: string): boolean {
  return key.startsWith("__other");
}

function variableName(leaf: PopulaceTreemapLeaf): string {
  return isSynthetic(leaf.key) ? leaf.variable : humanizeName(leaf.variable) || leaf.variable;
}

function measureLabel(measure: string | null): string {
  if (!measure || measure === "total") return "amount";
  return measure;
}

// Scored-weighted central error — a fair representative for an aggregated tile.
function weightedError(
  items: PopulaceTreemapLeaf[],
  pick: (leaf: PopulaceTreemapLeaf) => number | null,
): number | null {
  let weight = 0;
  let sum = 0;
  for (const it of items) {
    const value = pick(it);
    if (value != null && it.scored > 0) {
      sum += value * it.scored;
      weight += it.scored;
    }
  }
  return weight ? sum / weight : null;
}

function aggregateLeaves(
  leaves: PopulaceTreemapLeaf[],
  key: string,
  source: string,
  variable: string,
): PopulaceTreemapLeaf {
  return {
    key,
    source,
    variable,
    measure: null,
    n_targets: leaves.reduce((a, c) => a + c.n_targets, 0),
    scored: leaves.reduce((a, c) => a + c.scored, 0),
    within_10pct: leaves.reduce((a, c) => a + c.within_10pct, 0),
    loss: leaves.reduce((a, c) => a + c.loss, 0),
    mean_abs_relative_error: weightedError(leaves, (l) => l.mean_abs_relative_error),
    median_abs_relative_error: weightedError(leaves, (l) => l.median_abs_relative_error),
  };
}

function condenseLeaves(
  children: PopulaceTreemapLeaf[],
  mode: SizeMode,
  groupArea: number,
): PopulaceTreemapLeaf[] {
  const groupValue = children.reduce((a, c) => a + metric(c, mode), 0);
  if (groupValue <= 0) return children;
  const big: PopulaceTreemapLeaf[] = [];
  const small: PopulaceTreemapLeaf[] = [];
  for (const c of children) {
    const area = (metric(c, mode) / groupValue) * groupArea;
    (area >= MIN_LEAF_AREA ? big : small).push(c);
  }
  if (small.length <= 1) return children;
  const source = small[0].source;
  return [
    ...big,
    aggregateLeaves(small, `__other__:${source}`, source, `+${small.length} more`),
  ];
}

// Roll tiny sources into one "Other sources" tile and tiny variables within a
// kept source into a "+N more" tile, sizing the cut by projected pixel area.
function condense(
  groups: PopulaceTreemapGroup[],
  mode: SizeMode,
  canvasArea: number,
): PopulaceTreemapGroup[] {
  const total = groups.reduce((a, g) => a + metric(g, mode), 0);
  if (total <= 0) return groups;
  const big: PopulaceTreemapGroup[] = [];
  const small: PopulaceTreemapGroup[] = [];
  for (const g of groups) {
    const area = (metric(g, mode) / total) * canvasArea;
    (area >= MIN_GROUP_AREA ? big : small).push(g);
  }

  let kept = big;
  if (small.length >= 2) {
    const agg = aggregateLeaves(
      small.flatMap((g) => g.children),
      OTHER_SOURCES_KEY,
      OTHER_SOURCES_KEY,
      `Other sources (${small.length})`,
    );
    kept = [
      ...big,
      {
        source: OTHER_SOURCES_KEY,
        label: "Other sources",
        n_targets: agg.n_targets,
        within_10pct: agg.within_10pct,
        scored: agg.scored,
        loss: agg.loss,
        mean_abs_relative_error: agg.mean_abs_relative_error,
        median_abs_relative_error: agg.median_abs_relative_error,
        children: [agg],
      },
    ];
  } else {
    kept = [...big, ...small];
  }

  return kept.map((g) =>
    g.source === OTHER_SOURCES_KEY
      ? g
      : {
          ...g,
          children: condenseLeaves(
            g.children,
            mode,
            (metric(g, mode) / total) * canvasArea,
          ),
        },
  );
}

interface LaidGroup {
  group: PopulaceTreemapGroup;
  rect: Placed<PopulaceTreemapGroup>;
  headerH: number;
  leaves: Placed<PopulaceTreemapLeaf>[];
}

function layout(
  groups: PopulaceTreemapGroup[],
  mode: SizeMode,
  width: number,
  height: number,
): LaidGroup[] {
  const condensed = condense(groups, mode, width * height);
  const sized = condensed
    .map((g) => ({ value: metric(g, mode), data: g }))
    .filter((g) => g.value > 0);
  const placedGroups = squarify(sized, { x: 0, y: 0, w: width, h: height });

  return placedGroups.map((rect) => {
    const inset = {
      x: rect.x + GROUP_GAP / 2,
      y: rect.y + GROUP_GAP / 2,
      w: Math.max(rect.w - GROUP_GAP, 0),
      h: Math.max(rect.h - GROUP_GAP, 0),
    };
    // The "Other sources" bucket is a single labelled tile — no header band.
    const headerH =
      rect.data.source !== OTHER_SOURCES_KEY && inset.h >= 64 && inset.w >= 90
        ? HEADER_H
        : 0;
    const inner = {
      x: inset.x,
      y: inset.y + headerH,
      w: inset.w,
      h: Math.max(inset.h - headerH, 0),
    };
    const sizedLeaves = rect.data.children
      .map((c) => ({ value: metric(c, mode), data: c }))
      .filter((c) => c.value > 0);
    return {
      group: rect.data,
      rect: { ...rect, ...inset },
      headerH,
      leaves: squarify(sizedLeaves, inner),
    };
  });
}

function SegmentedToggle({
  mode,
  onChange,
}: {
  mode: SizeMode;
  onChange: (mode: SizeMode) => void;
}) {
  const options: { value: SizeMode; label: string }[] = [
    { value: "targets", label: "What we calibrate to" },
    { value: "loss", label: "Loss sources" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Size tiles by"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1"
    >
      {options.map((option) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-full px-4 text-[13px] font-medium transition-all ${
              active
                ? "bg-white text-foreground shadow-sm ring-1 ring-black/5"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FitLegend() {
  return (
    <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
        Median error
      </span>
      <div className="flex flex-col gap-1">
        <span
          className="h-2 w-36 rounded-full ring-1 ring-black/5"
          style={{
            background: `linear-gradient(to right, ${FIT_LEGEND.map((s) =>
              fitColor(s.error),
            ).join(", ")})`,
          }}
        />
        <div className="flex w-36 justify-between font-mono text-[9px] leading-none text-muted-foreground/80">
          {FIT_LEGEND.map((s) => (
            <span key={s.label}>{s.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function HoverCard({
  leaf,
  group,
  totalTargets,
  totalLoss,
}: {
  leaf: PopulaceTreemapLeaf;
  group: PopulaceTreemapGroup;
  totalTargets: number;
  totalLoss: number;
}) {
  const within = leaf.scored > 0 ? leaf.within_10pct / leaf.scored : null;
  const targetShare = totalTargets ? leaf.n_targets / totalTargets : null;
  const lossShare = totalLoss ? leaf.loss / totalLoss : null;
  const swatch = fitColor(leaf.median_abs_relative_error);
  return (
    <div className="pointer-events-none w-[17rem] overflow-hidden rounded-xl border border-border bg-white/95 shadow-xl ring-1 ring-black/5 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border/70 px-3.5 py-2.5">
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10"
          style={{ background: swatch }}
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight text-foreground">
            {variableName(leaf)}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {isSynthetic(leaf.key)
              ? "Grouped for legibility"
              : `${group.label} · ${measureLabel(leaf.measure)}`}
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 py-3 text-[12px]">
        <Stat label="Targets" value={fmt(leaf.n_targets, { digits: 0 })} sub={targetShare == null ? undefined : `${fmt(targetShare, { pct: true, digits: 1 })} of all`} />
        <Stat label="Within 10%" value={within == null ? "—" : fmt(within, { pct: true, digits: 0 })} />
        <Stat label="Median error" value={fmt(leaf.median_abs_relative_error, { pct: true, digits: 1 })} />
        <Stat label="Share of loss" value={lossShare == null ? "—" : fmt(lossShare, { pct: true, digits: 1 })} />
      </dl>
      <div className="border-t border-border/70 bg-muted/30 px-3.5 py-2 text-[11px] text-muted-foreground">
        Click to open these targets
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-[13px] font-semibold leading-none text-foreground">
        {value}
      </dd>
      {sub && <dd className="mt-0.5 text-[10px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}

export function CalibrationMap({
  data,
  release,
}: {
  data: PopulaceTreemapResponse;
  release?: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const [mode, setMode] = useState<SizeMode>("targets");
  const [selected, setSelected] = useState<{
    leaf: PopulaceTreemapLeaf;
    group: PopulaceTreemapGroup;
  } | null>(null);
  const [hover, setHover] = useState<{
    leaf: PopulaceTreemapLeaf;
    group: PopulaceTreemapGroup;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = Math.round(Math.min(Math.max(width * 0.58, 460), 680));
  const groups = useMemo(
    () => layout(data.groups, mode, width, height),
    [data.groups, mode, width, height],
  );

  function openLeaf(leaf: PopulaceTreemapLeaf, group: PopulaceTreemapGroup) {
    // The "Other sources" catch-all has no single filter — send it to the full
    // table. Every real cluster expands inline below the map.
    if (leaf.source === OTHER_SOURCES_KEY) {
      router.push("/populace/targets");
      return;
    }
    setHover(null);
    setSelected((current) =>
      current?.leaf.key === leaf.key && current?.group.source === group.source
        ? null
        : { leaf, group },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedToggle
          mode={mode}
          onChange={(next) => {
            setMode(next);
            setSelected(null);
          }}
        />
        <FitLegend />
      </div>

      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
      >
        {groups.map(({ group, rect, headerH, leaves }) => (
          <div key={group.source}>
            {headerH > 0 && (
              <div
                className="absolute flex items-baseline gap-2 overflow-hidden"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: headerH }}
              >
                <span className="truncate text-[12px] font-semibold tracking-tight text-foreground">
                  {group.label}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {fmt(group.n_targets, { digits: 0 })}
                </span>
              </div>
            )}
            {leaves.map((leaf) => {
              const fitError = leaf.data.median_abs_relative_error;
              const color = fitColor(fitError);
              const ink = readableInk(fitError);
              const w = Math.max(leaf.w - LEAF_GAP, 0);
              const h = Math.max(leaf.h - LEAF_GAP, 0);
              // Sub-pixel slivers carry no visual signal and only add noise.
              if (w < 4 || h < 4) return null;
              // Keep the radius proportional so tiny tiles stay square instead of
              // collapsing into overlapping-looking circles.
              const radius = Math.max(1.5, Math.min(6, Math.min(w, h) * 0.3));
              const showText = w >= 56 && h >= 28;
              const showSub = w >= 76 && h >= 50;
              // Wrap the name to as many lines as the tile actually has room for,
              // so a name only truncates when the box is genuinely too small.
              const nameLines = Math.max(
                1,
                Math.min(4, Math.floor((h - 12 - (showSub ? 13 : 0)) / 12.8)),
              );
              const isHover =
                hover?.leaf.key === leaf.data.key &&
                hover?.group.source === group.source;
              const isSelected =
                selected?.leaf.key === leaf.data.key &&
                selected?.group.source === group.source;
              return (
                <button
                  type="button"
                  key={leaf.data.key}
                  aria-label={`${variableName(leaf.data)}, ${group.label}, ${fmt(
                    leaf.data.n_targets,
                    { digits: 0 },
                  )} targets`}
                  aria-pressed={isSelected}
                  onClick={() => openLeaf(leaf.data, group)}
                  onMouseMove={(event) => {
                    const box = containerRef.current?.getBoundingClientRect();
                    if (!box) return;
                    setHover({
                      leaf: leaf.data,
                      group,
                      x: event.clientX - box.left,
                      y: event.clientY - box.top,
                    });
                  }}
                  className="group absolute flex flex-col gap-0.5 overflow-hidden px-1.5 py-1.5 text-left outline-none transition-[transform,box-shadow,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                  style={{
                    left: leaf.x + LEAF_GAP / 2,
                    top: leaf.y + LEAF_GAP / 2,
                    width: w,
                    height: h,
                    borderRadius: radius,
                    background: color,
                    color: ink,
                    zIndex: isSelected ? 11 : isHover ? 10 : 1,
                    transform:
                      isHover || isSelected ? "scale(1.012)" : "scale(1)",
                    boxShadow: isSelected
                      ? "0 0 0 2px #ffffff, 0 0 0 4px #319795, 0 8px 22px -6px rgba(15,23,42,0.35)"
                      : isHover
                        ? "0 6px 20px -4px rgba(15,23,42,0.28)"
                        : "inset 0 0 0 1px rgba(255,255,255,0.06)",
                    opacity: selected && !isSelected ? 0.62 : 1,
                  }}
                >
                  {showText && (
                    <span
                      className="text-[11px] font-semibold leading-[1.2] break-words"
                      style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: nameLines,
                        overflow: "hidden",
                      }}
                    >
                      {variableName(leaf.data)}
                    </span>
                  )}
                  {showSub && (
                    <span
                      className="truncate text-[10px] font-medium leading-tight"
                      style={{ opacity: 0.78 }}
                    >
                      {isSynthetic(leaf.data.key)
                        ? `${fmt(leaf.data.n_targets, { digits: 0 })} targets`
                        : `${measureLabel(leaf.data.measure)} · ${fmt(leaf.data.n_targets, { digits: 0 })}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {hover && (
          <div
            className="absolute z-20"
            style={(() => {
              const CARD_W = 272;
              const CARD_H = 176;
              // Open the card away from the cursor's quadrant so, near the dense
              // bottom-right corner, it expands over the large tiles instead of
              // covering the small ones being explored.
              const left =
                hover.x > width * 0.55 ? hover.x - CARD_W - 14 : hover.x + 14;
              const top =
                hover.y > height * 0.55 ? hover.y - CARD_H - 14 : hover.y + 14;
              return {
                left: Math.max(4, Math.min(left, width - CARD_W - 4)),
                top: Math.max(4, Math.min(top, height - CARD_H - 4)),
              };
            })()}
          >
            <HoverCard
              leaf={hover.leaf}
              group={hover.group}
              totalTargets={data.total_targets}
              totalLoss={data.total_loss}
            />
          </div>
        )}

        {/* cluster detail pops out over the graph */}
        {selected && (
          <div className="absolute inset-0 z-30">
            <style>{`@keyframes scrimIn{from{opacity:0}to{opacity:1}}@keyframes popIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:none}}`}</style>
            <button
              type="button"
              aria-label="Close cluster details"
              onClick={() => setSelected(null)}
              className="absolute inset-0 cursor-default bg-slate-900/20 backdrop-blur-[2px] motion-safe:animate-[scrimIn_140ms_ease-out]"
            />
            <div className="absolute inset-2 motion-safe:animate-[popIn_180ms_cubic-bezier(0.16,1,0.3,1)] sm:inset-3">
              <ClusterDetail
                key={`${selected.group.source}:${selected.leaf.key}`}
                leaf={selected.leaf}
                group={selected.group}
                release={release}
                onClose={() => setSelected(null)}
              />
            </div>
          </div>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Each tile is a group of calibration targets. Area shows{" "}
        <span className="font-medium text-foreground">
          {mode === "targets" ? "how many targets it covers" : "its share of the calibration loss"}
        </span>
        ; color shows the median gap between the weighted data and the official
        figure. Hover for detail, click a tile to pop out its targets.
      </p>
    </div>
  );
}
