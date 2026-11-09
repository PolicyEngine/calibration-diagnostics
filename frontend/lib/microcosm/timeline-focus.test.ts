import { expect, test } from "bun:test";

import type { BuildPhase } from "@/lib/microcosm/build-monitor";
import {
  NO_FOCUS,
  pointerHovers,
  stageFocus,
  togglePhase,
  toggleStage,
  wholeRunLabel,
} from "@/lib/microcosm/timeline-focus";

const phases = (...ids: BuildPhase[]): ReadonlySet<BuildPhase> => new Set(ids);

test("the Whole run bar is renamed while a stage-type filter is on", () => {
  expect(wholeRunLabel(phases())).toBe("Whole run");
  expect(wholeRunLabel(phases("calibrate"))).toBe("Whole run (filtered)");
});

test("a stage-type filter leaves only the picked types in Whole run", () => {
  const focus = { ...NO_FOCUS, filter: phases("calibrate", "compile") };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "compile", "compile-2")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "setup", "load_inputs-0")).toEqual({ visible: false, dimmed: false });
});

test("hovering a stage type dims every stage of the other types, even beside a clicked stage", () => {
  const focus = { ...NO_FOCUS, hoveredPhase: "checks" as const };
  expect(stageFocus(focus, "checks", "gates-4")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "setup", "load_inputs-0")).toEqual({ visible: true, dimmed: true });
  const withStage = { ...focus, selectedStage: "calibrate-3" };
  expect(stageFocus(withStage, "checks", "gates-4")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(withStage, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: true });
});

test("a clicked stage stays at full strength and every other stage is dimmed", () => {
  const focus = { ...NO_FOCUS, selectedStage: "calibrate-3" };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
  expect(stageFocus(focus, "calibrate", "calibrate-5")).toEqual({ visible: true, dimmed: true });
  expect(stageFocus(focus, "export", "export-6")).toEqual({ visible: true, dimmed: true });
});

test("stage types add up in the filter, and clicking a type or a stage again turns it off", () => {
  const twice = togglePhase(togglePhase(phases(), "calibrate"), "compile");
  expect([...twice].sort()).toEqual(["calibrate", "compile"]);
  expect([...togglePhase(twice, "calibrate")]).toEqual(["compile"]);
  expect(toggleStage(null, "calibrate-3")).toBe("calibrate-3");
  expect(toggleStage("calibrate-3", "calibrate-3")).toBeNull();
  expect(toggleStage("calibrate-3", "export-6")).toBe("export-6");
});

test("with a filter on, hovering a type or clicking a stage still dims breakdown rows of hidden types", () => {
  const hovered = { ...NO_FOCUS, filter: phases("calibrate"), hoveredPhase: "calibrate" as const };
  expect(stageFocus(hovered, "setup", "load_inputs-0")).toEqual({ visible: false, dimmed: true });
  const clicked = { ...NO_FOCUS, filter: phases("calibrate"), selectedStage: "calibrate-3", selectedPhase: "calibrate" as const };
  expect(stageFocus(clicked, "setup", "load_inputs-0")).toEqual({ visible: false, dimmed: true });
});

test("a clicked stage whose type the filter hides dims nothing", () => {
  const focus = { ...NO_FOCUS, filter: phases("calibrate"), selectedStage: "load_inputs-0", selectedPhase: "setup" as const };
  expect(stageFocus(focus, "calibrate", "calibrate-3")).toEqual({ visible: true, dimmed: false });
});

test("only a mouse or pen opens a stage type's hover card; a tap does not leave it open", () => {
  expect(pointerHovers("mouse")).toBe(true);
  expect(pointerHovers("pen")).toBe(true);
  expect(pointerHovers("touch")).toBe(false);
});
