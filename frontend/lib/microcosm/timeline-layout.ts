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

// The Whole run bar's time axis under a stage-type filter: the picked types'
// stages laid end to end in the order they ran, with the time between and
// around them left out, so together they fill the bar. Gives where each shown
// stage starts on that axis, and its length.
export function filteredAxis(
  stages: readonly StageExtent[],
  filter: ReadonlySet<BuildPhase>,
): { starts: Map<string, number>; length: number } {
  const starts = new Map<string, number>();
  let length = 0;
  for (const stage of inRunOrder(stages)) {
    if (!filter.has(stage.phase)) continue;
    starts.set(stage.key, length);
    length += Math.max(0, stage.end - stage.start);
  }
  return { starts, length };
}
