/**
 * What moved at a build (calibration-diagnostics#224): the outputs ranked by how large their
 * step to that build is beside their own typical step.
 *
 * The yardstick is each output's own history (María, 26 November 2026): the step divided by the
 * median of the output's earlier steps, so no outside threshold is needed. An output with fewer
 * than three earlier steps is ranked by the size of its step alone, after the others.
 *
 * Every number here is one output's own published step. A step beside a withheld cell is never
 * ranked, sized or compared: it is counted as withheld and nothing else.
 */
import { stepsInPoints } from "./release-history-format";
import type { OutputEntry } from "./release-history-outputs";
import type { TimelineBuild } from "./release-history-store";

/** How many earlier steps an output needs before its typical step means something. */
export const MIN_STEPS_FOR_TYPICAL = 3;

export interface StepMove {
  entry: OutputEntry;
  /** The step, signed: a percentage for money and counts, percentage points for rates. */
  signed: number;
  size: number;
  measure: "percent" | "points";
  /** The median size of the output's earlier steps; null with fewer than three of them. */
  typical: number | null;
  /** `size / typical`; infinite when the output never moved before; null without a typical step. */
  ratio: number | null;
  /** Whether the step took the output nearer to its official figure, when it has one. */
  official: { before: number; after: number; direction: "nearer" | "further" | "same" } | null;
}

export interface StepSummary {
  buildIndex: number;
  /** The build the steps come from: the neighbour the outputs were compared with. */
  fromBuildId: string | null;
  /** The build publishes the file of an earlier build, so no output can have moved. */
  sameFile: boolean;
  /** The outputs that moved, largest first by the yardstick. */
  moved: StepMove[];
  unchanged: number;
  withheld: number;
  /** Outputs with no step to this build: no value here, or none at the build before. */
  noStep: number;
  /** Whether any output is ranked by its typical step (false while the series is too short). */
  rankedByTypical: boolean;
}

/**
 * An output's step to a build, in the measure its unit is told in; null when it has none. Money
 * and counts are told in percent of the value before: a step of nothing is 0 whatever that value
 * was, and a step away from a value of zero is infinite, for no percentage can tell it.
 */
export function stepOf(entry: OutputEntry, buildIndex: number): { signed: number; measure: StepMove["measure"] } | null {
  const value = entry.values[buildIndex];
  if (!value || value.changeStatus !== "ok" || value.change === null) return null;
  if (stepsInPoints(entry.unit)) {
    return value.changePoints === null ? null : { signed: value.changePoints, measure: "points" };
  }
  if (value.change === 0) return { signed: 0, measure: "percent" };
  return {
    signed: value.relativeChange === null ? Math.sign(value.change) * Number.POSITIVE_INFINITY : value.relativeChange * 100,
    measure: "percent",
  };
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The median size of an output's steps before a build. A build that republishes an earlier
 * build's file is left out: its step is zero by construction and says nothing about the data.
 */
export function typicalStep(
  entry: OutputEntry,
  builds: readonly TimelineBuild[],
  buildIndex: number,
): number | null {
  const sizes: number[] = [];
  for (let index = 0; index < buildIndex; index += 1) {
    if (builds[index].sameFileAs !== null) continue;
    const step = stepOf(entry, index);
    if (step && Number.isFinite(step.signed)) sizes.push(Math.abs(step.signed));
  }
  return sizes.length < MIN_STEPS_FOR_TYPICAL ? null : median(sizes.sort((left, right) => left - right));
}

function officialMove(
  entry: OutputEntry,
  builds: readonly TimelineBuild[],
  buildIndex: number,
): StepMove["official"] {
  const value = entry.values[buildIndex];
  if (entry.official === null || value.value === null || value.comparedWith === null) return null;
  const previous = entry.values[builds.findIndex((build) => build.buildId === value.comparedWith)]?.value;
  if (previous === null || previous === undefined) return null;
  const before = Math.abs(previous - entry.official);
  const after = Math.abs(value.value - entry.official);
  return { before, after, direction: after < before ? "nearer" : after > before ? "further" : "same" };
}

/** Largest ratio first; an output with no typical step comes after, by the size of its step. */
function byYardstick(left: StepMove, right: StepMove): number {
  if ((left.ratio === null) !== (right.ratio === null)) return left.ratio === null ? 1 : -1;
  const leftRank = left.ratio ?? left.size;
  const rightRank = right.ratio ?? right.size;
  if (leftRank !== rightRank) return rightRank - leftRank;
  if (left.size !== right.size) return right.size - left.size;
  return left.entry.key < right.entry.key ? -1 : left.entry.key > right.entry.key ? 1 : 0;
}

/** The newest build that is measured and on the axis: the build "what moved" speaks of. */
export function latestMeasuredBuild(builds: readonly TimelineBuild[]): number | null {
  for (let index = builds.length - 1; index >= 0; index -= 1) {
    if (builds[index].state === "measured" && !builds[index].withdrawn) return index;
  }
  return null;
}

/** What each output did at one build. `entries` are the outputs to rank: all, or the headline ones. */
export function stepSummary(
  entries: readonly OutputEntry[],
  builds: readonly TimelineBuild[],
  buildIndex: number,
): StepSummary {
  const summary: StepSummary = {
    buildIndex,
    fromBuildId: null,
    sameFile: builds[buildIndex]?.sameFileAs != null,
    moved: [],
    unchanged: 0,
    withheld: 0,
    noStep: 0,
    rankedByTypical: false,
  };
  for (const entry of entries) {
    const value = entry.values[buildIndex];
    if (!value) continue;
    if (value.comparedWith !== null) summary.fromBuildId ??= value.comparedWith;
    if (value.changeStatus === "withheld" || value.status === "withheld") {
      summary.withheld += 1;
      continue;
    }
    const step = stepOf(entry, buildIndex);
    if (!step) {
      summary.noStep += 1;
      continue;
    }
    const size = Math.abs(step.signed);
    if (size === 0) {
      summary.unchanged += 1;
      continue;
    }
    const typical = typicalStep(entry, builds, buildIndex);
    summary.moved.push({
      entry,
      signed: step.signed,
      size,
      measure: step.measure,
      typical,
      ratio: typical === null ? null : typical === 0 ? Number.POSITIVE_INFINITY : size / typical,
      official: officialMove(entry, builds, buildIndex),
    });
  }
  summary.moved.sort(byYardstick);
  summary.rankedByTypical = summary.moved.some((move) => move.ratio !== null);
  return summary;
}
