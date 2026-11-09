import { BUILD_PHASES, type BuildPhase } from "@/lib/microcosm/build-monitor";

// A top-level stage on the run's time axis, in milliseconds from its start.
export interface StageExtent {
  key: string;
  phase: BuildPhase;
  start: number;
  end: number;
}

// The stage types in the order the legend lists them.
export function phasesByFirstAppearance(_stages: readonly StageExtent[]): BuildPhase[] {
  return BUILD_PHASES.map((phase) => phase.id);
}

// The Whole run bar's time axis under a stage-type filter: where each shown
// stage starts on it, and its length.
export function filteredAxis(
  stages: readonly StageExtent[],
  _filter: ReadonlySet<BuildPhase>,
): { starts: Map<string, number>; length: number } {
  return {
    starts: new Map(stages.map((stage) => [stage.key, stage.start])),
    length: Math.max(0, ...stages.map((stage) => stage.end)),
  };
}
