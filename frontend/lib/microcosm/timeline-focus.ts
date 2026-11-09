import type { BuildPhase } from "@/lib/microcosm/build-monitor";

// What the build monitor's Timeline is focused on: the stage types picked to
// filter the Whole run bar, the stage type under the pointer, and the stage
// clicked in the breakdown (by its row key).
export interface TimelineFocus {
  filter: ReadonlySet<BuildPhase>;
  hoveredPhase: BuildPhase | null;
  selectedStage: string | null;
  // The selected stage's type, when known.
  selectedPhase?: BuildPhase | null;
  // The stage under the pointer in the breakdown, by its row key.
  hoveredStage?: string | null;
}

export const NO_FOCUS: TimelineFocus = {
  filter: new Set(),
  hoveredPhase: null,
  selectedStage: null,
  selectedPhase: null,
  hoveredStage: null,
};

// The Whole run bar's label.
export function wholeRunLabel(filter: ReadonlySet<BuildPhase>): string {
  return filter.size ? "Whole run (filtered)" : "Whole run";
}

// How one stage is drawn: in Whole run, hidden when a filter leaves its type
// out; there and in the breakdown, which is never filtered, dimmed while
// another type is hovered, or, with no type hovered, while another stage is
// clicked. A clicked stage whose type the filter hides dims nothing.
export function stageFocus(
  focus: TimelineFocus,
  phase: BuildPhase,
  stageKey: string,
): { visible: boolean; dimmed: boolean } {
  const passesFilter = (candidate: BuildPhase | null | undefined) =>
    !focus.filter.size || candidate == null || focus.filter.has(candidate);
  const visible = !focus.filter.size || focus.filter.has(phase);
  const selectionShown = focus.selectedStage != null && passesFilter(focus.selectedPhase);
  const dimmed = focus.hoveredPhase
    ? phase !== focus.hoveredPhase
    : selectionShown && stageKey !== focus.selectedStage;
  return { visible, dimmed };
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

// Whether a pointer entering a stage-type label shows its hover card: a
// mouse or a pen. A tap would leave the card open, and its type hovered,
// until the next tap elsewhere.
export function pointerHovers(pointerType: string): boolean {
  return pointerType === "mouse" || pointerType === "pen";
}
