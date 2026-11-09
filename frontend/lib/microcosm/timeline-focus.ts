import type { BuildPhase } from "@/lib/microcosm/build-monitor";

// What the build monitor's Timeline is focused on: the stage types picked to
// filter the Whole run bar, the stage type under the pointer, and the stage
// clicked in the breakdown (by its row key).
export interface TimelineFocus {
  filter: ReadonlySet<BuildPhase>;
  hoveredPhase: BuildPhase | null;
  selectedStage: string | null;
}

export const NO_FOCUS: TimelineFocus = { filter: new Set(), hoveredPhase: null, selectedStage: null };

// The Whole run bar's label.
export function wholeRunLabel(_filter: ReadonlySet<BuildPhase>): string {
  return "Whole run";
}

// How one stage's segment is drawn: whether it shows at all, and whether it
// is dimmed.
export function stageFocus(
  _focus: TimelineFocus,
  _phase: BuildPhase,
  _stageKey: string,
): { visible: boolean; dimmed: boolean } {
  return { visible: true, dimmed: false };
}

// The filter after clicking a stage type.
export function togglePhase(filter: ReadonlySet<BuildPhase>, _phase: BuildPhase): ReadonlySet<BuildPhase> {
  return filter;
}

// The selected stage after clicking a stage.
export function toggleStage(selected: string | null, _stageKey: string): string | null {
  return selected;
}
