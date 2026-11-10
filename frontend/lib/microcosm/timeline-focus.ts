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

// The clicked stage, by its row key, when it narrows the Timeline to itself:
// with no stage-type filter on, or with its type picked. A clicked stage
// whose type the filter hides narrows nothing.
export function narrowedToStage(focus: TimelineFocus): string | null {
  if (focus.selectedStage == null) return null;
  const phase = focus.selectedPhase;
  return !focus.filter.size || phase == null || focus.filter.has(phase) ? focus.selectedStage : null;
}

// Whether the Timeline shows only some stages: those of the picked types, or
// the clicked stage.
export function focusNarrows(focus: TimelineFocus): boolean {
  return focus.filter.size > 0 || narrowedToStage(focus) != null;
}

// The Whole run bar's label.
export function wholeRunLabel(focus: TimelineFocus): string {
  return focusNarrows(focus) ? "Whole run (filtered)" : "Whole run";
}

// How one stage is drawn: hidden when a filter leaves its type out or
// another stage is clicked; dimmed while another type is hovered, else while
// another stage is hovered in the breakdown.
export function stageFocus(
  focus: TimelineFocus,
  phase: BuildPhase,
  stageKey: string,
): { visible: boolean; dimmed: boolean } {
  const clicked = narrowedToStage(focus);
  const visible = (!focus.filter.size || focus.filter.has(phase)) && (clicked == null || stageKey === clicked);
  const dimmed = focus.hoveredPhase
    ? phase !== focus.hoveredPhase
    : focus.hoveredStage
      ? stageKey !== focus.hoveredStage
      : false;
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

// The focus with a hovered or clicked stage that no drawn row has left out.
// A refresh can drop a running run's expected stages, or renumber them, under
// a resting pointer, which then never reports leaving; a key that matches no
// row would otherwise dim every stage.
export function focusOnDrawnStages(focus: TimelineFocus, drawnStageKeys: ReadonlySet<string>): TimelineFocus {
  const hoveredDrawn = focus.hoveredStage != null && drawnStageKeys.has(focus.hoveredStage);
  const selectedDrawn = focus.selectedStage != null && drawnStageKeys.has(focus.selectedStage);
  return {
    ...focus,
    hoveredStage: hoveredDrawn ? focus.hoveredStage : null,
    selectedStage: selectedDrawn ? focus.selectedStage : null,
    selectedPhase: selectedDrawn ? focus.selectedPhase : null,
  };
}

// What the Timeline card keeps between renders: the run it is showing, what
// is open, and what is picked, clicked and hovered.
export interface TimelineCardState {
  runId: string;
  // Whether the per-stage breakdown is open.
  expanded: boolean;
  // Whether the Memory and CPU charts are open.
  chartsExpanded: boolean;
  filter: ReadonlySet<BuildPhase>;
  hoveredPhase: BuildPhase | null;
  selected: { stageKey: string; phase: BuildPhase } | null;
  hoveredStage: string | null;
}

export type TimelineCardAction =
  | { kind: "show_run"; runId: string }
  | { kind: "toggle_expanded" }
  | { kind: "toggle_charts" }
  | { kind: "hover_phase"; phase: BuildPhase | null }
  | { kind: "toggle_phase"; phase: BuildPhase }
  | { kind: "hover_stage"; stageKey: string | null }
  | { kind: "toggle_stage"; stageKey: string; phase: BuildPhase };

export function initialTimelineCard(runId: string): TimelineCardState {
  return {
    runId,
    expanded: false,
    chartsExpanded: false,
    filter: NO_FOCUS.filter,
    hoveredPhase: null,
    selected: null,
    hoveredStage: null,
  };
}

export function nextTimelineCard(state: TimelineCardState, _action: TimelineCardAction): TimelineCardState {
  return state;
}
