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
export function wholeRunLabel(filter: ReadonlySet<BuildPhase>): string {
  return filter.size ? "Whole run (filtered)" : "Whole run";
}

// How one stage's segment is drawn: hidden when a filter leaves its type
// out; dimmed while another type is hovered, or, with no type hovered, while
// another stage is clicked.
export function stageFocus(
  focus: TimelineFocus,
  phase: BuildPhase,
  stageKey: string,
): { visible: boolean; dimmed: boolean } {
  const visible = !focus.filter.size || focus.filter.has(phase);
  const dimmed = focus.hoveredPhase
    ? phase !== focus.hoveredPhase
    : focus.selectedStage != null && stageKey !== focus.selectedStage;
  return { visible, dimmed: visible && dimmed };
}

// The filter after clicking a stage type: added, or removed when it was on.
export function togglePhase(filter: ReadonlySet<BuildPhase>, phase: BuildPhase): ReadonlySet<BuildPhase> {
  const next = new Set(filter);
  if (next.has(phase)) next.delete(phase);
  else next.add(phase);
  return next;
}

// The selected stage after clicking a stage: it, or none when it was selected.
export function toggleStage(selected: string | null, stageKey: string): string | null {
  return selected === stageKey ? null : stageKey;
}
