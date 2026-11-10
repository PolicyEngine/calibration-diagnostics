import { BUILD_PHASES, type BuildPhase } from "@/lib/microcosm/build-monitor";

// A top-level stage on the run's time axis, in milliseconds from its start.
export interface StageExtent {
  key: string;
  phase: BuildPhase;
  start: number;
  end: number;
}

function inRunOrder(stages: readonly StageExtent[]): StageExtent[] {
  return [...stages].sort((first, second) => first.start - second.start || first.end - second.end);
}

// The stage types in the order the build first reached them, then the types
// it never reached in their usual order.
export function phasesByFirstAppearance(stages: readonly StageExtent[]): BuildPhase[] {
  const reached: BuildPhase[] = [];
  for (const stage of inRunOrder(stages)) {
    if (!reached.includes(stage.phase)) reached.push(stage.phase);
  }
  return [...reached, ...BUILD_PHASES.map((phase) => phase.id).filter((phase) => !reached.includes(phase))];
}

// The Whole run bar's time axis under a stage-type filter, or with a stage
// clicked (`onlyStage`, by its key): the shown stages laid end to end in the
// order they ran, with the time between and around them left out, so together
// they fill the bar. Gives where each shown stage starts on that axis and its
// length, and where each hidden stage sits with no length (between the shown
// stages it ran between), so a change of filter can animate the hidden stages
// shrinking and the shown ones growing.
export function filteredAxis(
  stages: readonly StageExtent[],
  filter: ReadonlySet<BuildPhase>,
  onlyStage: string | null = null,
): { starts: Map<string, number>; length: number; collapsed: Map<string, number> } {
  const starts = new Map<string, number>();
  const collapsed = new Map<string, number>();
  let length = 0;
  for (const stage of inRunOrder(stages)) {
    const shown = (!filter.size || filter.has(stage.phase)) && (onlyStage == null || stage.key === onlyStage);
    if (!shown) {
      collapsed.set(stage.key, length);
      continue;
    }
    starts.set(stage.key, length);
    length += Math.max(0, stage.end - stage.start);
  }
  return { starts, length, collapsed };
}

// Where a time in the run (milliseconds from its start) falls on the filtered
// axis: inside a shown stage, at that stage's place; elsewhere, nowhere.
export function axisOffset(
  offset: number,
  stages: readonly StageExtent[],
  axis: ReturnType<typeof filteredAxis>,
): number | null {
  for (const stage of stages) {
    const base = axis.starts.get(stage.key);
    if (base != null && offset >= stage.start && offset <= stage.end) return base + (offset - stage.start);
  }
  return null;
}

// A stretch of the run on the filtered axis: the parts of it inside shown
// stages, each at that stage's place, in the order they ran.
export function axisIntervals(
  start: number,
  end: number,
  stages: readonly StageExtent[],
  axis: ReturnType<typeof filteredAxis>,
): { start: number; end: number }[] {
  const parts: { start: number; end: number }[] = [];
  for (const stage of inRunOrder(stages)) {
    const base = axis.starts.get(stage.key);
    const from = Math.max(start, stage.start);
    const to = Math.min(end, stage.end);
    if (base == null || to <= from) continue;
    parts.push({ start: base + (from - stage.start), end: base + (to - stage.start) });
  }
  return parts;
}
