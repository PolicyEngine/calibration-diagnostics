import { describe, expect, test } from "bun:test";

import type { BuildPhase } from "@/lib/microcosm/build-monitor";
import {
  focusOnDrawnStages,
  initialTimelineCard,
  nextTimelineCard,
  NO_FOCUS,
  pointerHovers,
  stageFocus,
  type TimelineCardState,
  togglePhase,
  toggleStage,
  wholeRunLabel,
} from "@/lib/microcosm/timeline-focus";

const phases = (...ids: BuildPhase[]): ReadonlySet<BuildPhase> => new Set(ids);

test("the Whole run bar is renamed while a stage-type filter or a clicked stage narrows it", () => {
  expect(wholeRunLabel(NO_FOCUS)).toBe("Whole run");
  expect(wholeRunLabel({ ...NO_FOCUS, filter: phases("calibrate") })).toBe("Whole run (filtered)");
  expect(wholeRunLabel({ ...NO_FOCUS, selectedStage: "calibrate-3", selectedPhase: "calibrate" })).toBe(
    "Whole run (filtered)",
  );
});

test("a stage-type filter leaves only the picked types in Whole run", () => {
  const focus = { ...NO_FOCUS, filter: phases("calibrate", "compile") };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "compile", "compile-2")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "setup", "load_inputs-0")).toEqual({ visible: false, dimmed: false });
});

test("hovering a stage type dims every stage of the other types, a clicked stage too", () => {
  const focus = { ...NO_FOCUS, hoveredPhase: "checks" as const };
  expect(stageFocus(focus, "checks", "gates-4")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "setup", "load_inputs-0")).toEqual({ visible: true, dimmed: true });
  const withStage = { ...focus, selectedStage: "calibrate-3", selectedPhase: "calibrate" as const };
  expect(stageFocus(withStage, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: true });
});

test("a clicked stage is the only stage shown, as a stage-type filter shows only its types", () => {
  const focus = { ...NO_FOCUS, selectedStage: "calibrate-3", selectedPhase: "calibrate" as const };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "calibrate", "calibrate-5")).toEqual({ visible: false, dimmed: false });
  expect(stageFocus(focus, "export", "export-6")).toEqual({ visible: false, dimmed: false });
});

test("stage types add up in the filter, and clicking a type or a stage again turns it off", () => {
  const twice = togglePhase(togglePhase(phases(), "calibrate"), "compile");
  expect([...twice].sort()).toEqual(["calibrate", "compile"]);
  expect([...togglePhase(twice, "calibrate")]).toEqual(["compile"]);
  expect(toggleStage(null, "calibrate-3")).toBe("calibrate-3");
  expect(toggleStage("calibrate-3", "calibrate-3")).toBeNull();
  expect(toggleStage("calibrate-3", "export-6")).toBe("export-6");
});

test("with a filter on, hovering a type still dims rows of hidden types, and a clicked stage narrows the filter to it", () => {
  const hovered = { ...NO_FOCUS, filter: phases("calibrate"), hoveredPhase: "calibrate" as const };
  expect(stageFocus(hovered, "setup", "load_inputs-0")).toEqual({ visible: false, dimmed: true });
  const clicked = { ...NO_FOCUS, filter: phases("calibrate"), selectedStage: "calibrate-3", selectedPhase: "calibrate" as const };
  expect(stageFocus(clicked, "setup", "load_inputs-0")).toEqual({ visible: false, dimmed: false });
  expect(stageFocus(clicked, "calibrate", "calibrate-5")).toEqual({ visible: false, dimmed: false });
  expect(stageFocus(clicked, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
});

test("a stage left hovered that the clicked stage hides dims nothing", () => {
  const focus = {
    ...NO_FOCUS,
    selectedStage: "calibrate-3",
    selectedPhase: "calibrate" as const,
    hoveredStage: "export-6",
  };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
});

test("a clicked stage whose type the filter hides narrows nothing", () => {
  const focus = { ...NO_FOCUS, filter: phases("calibrate"), selectedStage: "load_inputs-0", selectedPhase: "setup" as const };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "calibrate", "calibrate-5")).toEqual({ visible: true, dimmed: false });
});

test("only a mouse or pen opens a stage type's hover card; a tap does not leave it open", () => {
  expect(pointerHovers("mouse")).toBe(true);
  expect(pointerHovers("pen")).toBe(true);
  expect(pointerHovers("touch")).toBe(false);
});

test("hovering a stage in the breakdown highlights it in Whole run, as clicking it does", () => {
  const focus = { ...NO_FOCUS, hoveredStage: "calibrate-3" };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "export", "export-6")).toEqual({ visible: true, dimmed: true });
});

test("a hovered stage type outranks a hovered stage", () => {
  const typeOverStage = { ...NO_FOCUS, hoveredPhase: "calibrate" as const, hoveredStage: "export-6" };
  expect(stageFocus(typeOverStage, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(typeOverStage, "export", "export-6")).toEqual({ visible: true, dimmed: true });
});

// A refresh can drop a running run's expected stages, or renumber them when
// the run starts a stage nobody expected, under a resting pointer.
test("a hovered or clicked stage that no drawn row has any more dims nothing", () => {
  const drawn = new Set(["calibrate-3", "export-6"]);
  const stale = focusOnDrawnStages({ ...NO_FOCUS, hoveredStage: "expected-9", selectedStage: "expected-8" }, drawn);
  expect(stageFocus(stale, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(stale, "export", "export-6")).toEqual({ visible: true, dimmed: false });
  // A stage still drawn keeps its highlight.
  const current = focusOnDrawnStages({ ...NO_FOCUS, hoveredStage: "export-6" }, drawn);
  expect(stageFocus(current, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: true });
});

describe("the Timeline card's state", () => {
  const card = (overrides: Partial<TimelineCardState> = {}): TimelineCardState => ({
    ...initialTimelineCard("run-a"),
    ...overrides,
  });
  const clicked = { stageKey: "calibrate-3", phase: "calibrate" as const };

  test("clicking a stage clears a stage left hovered, so the clicked stage is not drawn faded", () => {
    const next = nextTimelineCard(card({ expanded: true, hoveredStage: "load_inputs-0" }), {
      kind: "toggle_stage",
      stageKey: "calibrate-3",
      phase: "calibrate",
    });
    expect(next.selected).toEqual(clicked);
    expect(next.hoveredStage).toBeNull();
    // Clicking it again shows every stage.
    expect(nextTimelineCard(next, { kind: "toggle_stage", stageKey: "calibrate-3", phase: "calibrate" }).selected).toBeNull();
  });

  test("picking or dropping a stage type clears the clicked stage", () => {
    const next = nextTimelineCard(card({ expanded: true, selected: clicked }), { kind: "toggle_phase", phase: "calibrate" });
    expect([...next.filter]).toEqual(["calibrate"]);
    expect(next.selected).toBeNull();
    const dropped = nextTimelineCard({ ...next, selected: clicked }, { kind: "toggle_phase", phase: "calibrate" });
    expect(dropped.filter.size).toBe(0);
    expect(dropped.selected).toBeNull();
  });

  test("closing the breakdown clears the clicked stage, whose row it hides", () => {
    const closed = nextTimelineCard(card({ expanded: true, selected: clicked, hoveredStage: "calibrate-3" }), {
      kind: "toggle_expanded",
    });
    expect(closed.expanded).toBe(false);
    expect(closed.selected).toBeNull();
    expect(closed.hoveredStage).toBeNull();
    expect(nextTimelineCard(closed, { kind: "toggle_expanded" }).expanded).toBe(true);
  });

  test("the charts' caret opens and closes the charts, and leaves the rest alone", () => {
    const open = nextTimelineCard(card({ selected: clicked }), { kind: "toggle_charts" });
    expect(open.chartsExpanded).toBe(true);
    expect(open.selected).toEqual(clicked);
    expect(nextTimelineCard(open, { kind: "toggle_charts" }).chartsExpanded).toBe(false);
  });

  test("hovering a type or a stage is kept until the pointer leaves", () => {
    expect(nextTimelineCard(card(), { kind: "hover_phase", phase: "setup" }).hoveredPhase).toBe("setup");
    expect(nextTimelineCard(card(), { kind: "hover_stage", stageKey: "export-6" }).hoveredStage).toBe("export-6");
  });

  test("another run starts with nothing picked, clicked or hovered; the breakdown and charts stay as they were", () => {
    const busy = card({
      expanded: true,
      chartsExpanded: true,
      filter: phases("calibrate"),
      hoveredPhase: "setup",
      selected: clicked,
      hoveredStage: "calibrate-3",
    });
    expect(nextTimelineCard(busy, { kind: "show_run", runId: "run-b" })).toEqual({
      ...initialTimelineCard("run-b"),
      expanded: true,
      chartsExpanded: true,
    });
  });
});
