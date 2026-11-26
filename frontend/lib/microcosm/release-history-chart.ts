/**
 * The layout of the release history chart (calibration-diagnostics#224): one output across the
 * builds of a series, as positions the page draws. Pure, so the tests check it with no browser.
 *
 * - One column per build, in publish order. A build with no value keeps its column, shaded and
 *   labelled, so the axis is the same on every engine.
 * - Relative: each value as a percentage above or below the output's official figure. Absolute:
 *   the values. An output with no official figure is drawn in values under both.
 * - A line joins two builds only where the timeline has a step between them (`comparedWith`).
 * - A withheld cell has a shaded column and no point: its value is never placed on the scale.
 */
import type { BuildMark } from "./release-history-builds";
import {
  dateShort,
  formatPercent,
  formatValue,
  versusOfficial,
} from "./release-history-format";
import type { OutputEntry } from "./release-history-outputs";
import type { TimelineBuild } from "./release-history-store";
import type { ChartScale } from "./release-history-url";

/** Why a column holds no point, in the words the chart prints on it. */
export type ColumnBand =
  | "withdrawn"
  | "withheld"
  | "not measured"
  | "gap"
  | "retrying"
  | "failed"
  | "no value";

export interface ChartColumn {
  index: number;
  buildId: string;
  /** The column's centre, and the left edge and width of its band and hit area. */
  x: number;
  left: number;
  width: number;
  band: ColumnBand | null;
  /** The value's marker. `hollow`: a withdrawn build's value, which no step joins. */
  point: { y: number; hollow: boolean } | null;
  current: boolean;
  /** The publish date under the axis, where it fits. */
  dateLabel: string | null;
  marks: BuildMark[];
}

export interface ChartLayout {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  /** Whether the values are drawn against the official figure. */
  relative: boolean;
  /** Relative was asked for, and the output has no official figure to draw against. */
  blocked: boolean;
  ticks: { y: number; label: string }[];
  /** The official figure's line: at 0% in the relative view, at its value in the absolute one. */
  official: { y: number; label: string } | null;
  columns: ChartColumn[];
  segments: { from: number; to: number; x1: number; y1: number; x2: number; y2: number }[];
  /** The one value the chart labels: the latest. */
  latestLabel: { x: number; y: number; text: string; anchor: "middle" | "end" } | null;
  /** Whether the band labels are turned to fit narrow columns. */
  verticalBandLabels: boolean;
  /** No build holds a value for this output. */
  empty: boolean;
}

export const CHART_HEIGHT = 330;
const MARGIN = { top: 18, right: 18, bottom: 64, left: 72 };
/** The least room a publish date needs under the axis. */
const DATE_LABEL_WIDTH = 46;
/** Below this column width a band's label is turned on its side. */
const HORIZONTAL_BAND_LABEL_WIDTH = 78;

/** Round axis values that cover the range, and the range they span. */
export function niceTicks(low: number, high: number, count = 4): { ticks: number[]; min: number; max: number } {
  let min = low;
  let max = high;
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((size) => size >= raw) ?? 10 * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= end + step / 2; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return { ticks, min: start, max: end };
}

/** As many decimals as the tick step needs, so a 2.5% step never prints as 3%. */
function tickDecimals(ticks: number[]): number {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const exact = (decimals: number) => Math.abs(Math.round(step * 10 ** decimals) - step * 10 ** decimals) < 1e-6;
  return [0, 1, 2, 3].find(exact) ?? 3;
}

/** Why a build's column holds no point for this output; null when it holds one. */
export function columnBand(build: TimelineBuild, status: OutputEntry["values"][number]["status"]): ColumnBand | null {
  if (build.withdrawn) return "withdrawn";
  if (status === "withheld") return "withheld";
  if (status === "ok") return null;
  if (build.state === "gap") return "gap";
  if (build.state === "retrying") return "retrying";
  if (build.state === "failed") return "failed";
  return build.state === "missing" ? "not measured" : "no value";
}

/** Which builds get a publish date: every k-th from the newest, and always the current one. */
function dateLabels(builds: readonly TimelineBuild[], xs: number[], step: number): (string | null)[] {
  const every = Math.max(1, Math.ceil(DATE_LABEL_WIDTH / step));
  const current = builds.findIndex((build) => build.current);
  return builds.map((build, index) => {
    if (index === current) return dateShort(build.publishedAt);
    if ((builds.length - 1 - index) % every !== 0) return null;
    // A date that would touch the current build's gives way to it.
    if (current !== -1 && Math.abs(xs[index] - xs[current]) < DATE_LABEL_WIDTH) return null;
    return dateShort(build.publishedAt);
  });
}

export function chartLayout(options: {
  builds: readonly TimelineBuild[];
  entry: OutputEntry;
  scale: ChartScale;
  currency: string | null;
  marks: readonly BuildMark[][];
  width: number;
}): ChartLayout {
  const { builds, entry, currency } = options;
  const width = Math.max(options.width, 280);
  const plot = {
    left: MARGIN.left,
    right: width - MARGIN.right,
    top: MARGIN.top,
    bottom: CHART_HEIGHT - MARGIN.bottom,
  };
  const official = entry.official;
  const relative = options.scale === "relative" && official !== null;
  // What the chart places for a stored value: the value, or its % above or below the official figure.
  const placed = (value: number) => (relative && official !== null ? versusOfficial(value, official) : value);
  const step = (plot.right - plot.left) / Math.max(builds.length, 1);
  const xs = builds.map((_, index) => plot.left + step * (index + 0.5));
  const values = builds.map((_, index) => entry.values[index]?.value ?? null);
  const known = values.filter((value): value is number => value !== null).map(placed);
  const empty = known.length === 0;

  // The official figure is always in range: 0% in the relative view, its value in the absolute one.
  const anchors = official === null ? [] : [placed(official)];
  const range = empty ? null : niceTicks(Math.min(...known, ...anchors), Math.max(...known, ...anchors));
  const yOf = (value: number) =>
    range === null
      ? plot.bottom
      : plot.bottom - ((value - range.min) / (range.max - range.min)) * (plot.bottom - plot.top);
  const decimals = range ? tickDecimals(range.ticks) : 0;
  const tickLabel = (tick: number) =>
    relative ? formatPercent(tick, decimals) : formatValue(tick, entry.unit, currency, 1);

  const dates = dateLabels(builds, xs, step);
  const columns = builds.map((build, index): ChartColumn => {
    const value = values[index];
    return {
      index,
      buildId: build.buildId,
      x: xs[index],
      left: xs[index] - step / 2,
      width: step,
      band: columnBand(build, entry.values[index]?.status ?? "unmeasured"),
      point: value === null || range === null ? null : { y: yOf(placed(value)), hollow: build.withdrawn },
      current: build.current,
      dateLabel: dates[index],
      marks: [...(options.marks[index] ?? [])],
    };
  });

  const indexOf = new Map(builds.map((build, index) => [build.buildId, index]));
  const segments: ChartLayout["segments"] = [];
  entry.values.forEach((value, to) => {
    const from = value.comparedWith === null ? undefined : indexOf.get(value.comparedWith);
    if (from === undefined) return;
    const start = columns[from]?.point;
    const end = columns[to]?.point;
    if (!start || !end) return;
    segments.push({ from, to, x1: columns[from].x, y1: start.y, x2: columns[to].x, y2: end.y });
  });

  let latestLabel: ChartLayout["latestLabel"] = null;
  for (let index = columns.length - 1; index >= 0 && latestLabel === null; index -= 1) {
    const value = values[index];
    const point = columns[index].point;
    // A withdrawn build's value is drawn, hollow, and never labelled as the latest.
    if (value === null || point === null || point.hollow) continue;
    latestLabel = {
      x: columns[index].x,
      y: point.y - 12,
      text: relative && official !== null
        ? formatPercent(versusOfficial(value, official), 2)
        : formatValue(value, entry.unit, currency),
      anchor: index === columns.length - 1 ? "end" : "middle",
    };
  }

  return {
    width,
    height: CHART_HEIGHT,
    plot,
    relative,
    blocked: options.scale === "relative" && official === null,
    ticks: range ? range.ticks.map((tick) => ({ y: yOf(tick), label: tickLabel(tick) })) : [],
    official:
      official === null || range === null
        ? null
        : {
            y: yOf(placed(official)),
            label: `${relative ? "0% = official " : "Official "}${formatValue(official, entry.unit, currency)}`,
          },
    columns,
    segments,
    latestLabel,
    verticalBandLabels: step < HORIZONTAL_BAND_LABEL_WIDTH,
    empty,
  };
}

/**
 * A small line of an output's values across the builds, broken where a build on the axis holds
 * none. A withdrawn build is passed over, as on the chart: no step starts or ends at it.
 */
export function sparklinePath(
  entry: OutputEntry,
  builds: ReadonlyArray<Pick<TimelineBuild, "withdrawn">>,
  size: { width: number; height: number } = { width: 56, height: 18 },
): { path: string; last: { x: number; y: number } | null } {
  const onAxis = entry.values.map((value, index) => (builds[index]?.withdrawn ? undefined : value.value));
  const known = onAxis.filter((value): value is number => typeof value === "number");
  if (known.length === 0) return { path: "", last: null };
  const min = Math.min(...known);
  const span = Math.max(...known) - min || 1;
  const x = (index: number) => 3 + (index * (size.width - 6)) / Math.max(onAxis.length - 1, 1);
  const y = (value: number) => size.height - 3 - ((value - min) / span) * (size.height - 6);
  let path = "";
  let last: { x: number; y: number } | null = null;
  let joined = false;
  onAxis.forEach((value, index) => {
    if (value === undefined) return;
    if (value === null) {
      joined = false;
      return;
    }
    path += `${joined ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)} `;
    last = { x: x(index), y: y(value) };
    joined = true;
  });
  return { path: path.trim(), last };
}
