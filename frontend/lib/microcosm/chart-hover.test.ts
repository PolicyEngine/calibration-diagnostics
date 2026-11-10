import { expect, test } from "bun:test";

import { type ChartHover, hoveredIndex, NO_CHART_HOVER, nextChartHover } from "./chart-hover";

// Three readings: one at 10, one standing for 20 to 25, one at 30.
const STRETCHES = [
  { first_ms: 10, last_ms: 10 },
  { first_ms: 20, last_ms: 25 },
  { first_ms: 30, last_ms: 30 },
];

function after(...events: Parameters<typeof nextChartHover>[1][]): ChartHover {
  return events.reduce((hover, event) => nextChartHover(hover, event, STRETCHES), NO_CHART_HOVER);
}

// A finger landing, lifting at the reading at `time`, and the leave that
// follows a lift.
const tap = (time: number | null, pointer = "touch") =>
  [
    { kind: "pointer_down", pointer_type: pointer, time_ms: time },
    { kind: "pointer_up", pointer_type: pointer, time_ms: time },
    { kind: "pointer_leave", pointer_type: pointer },
  ] as const;

test("a tap shows the reading under it, and lifting the finger keeps it shown", () => {
  expect(hoveredIndex(STRETCHES, after(...tap(25)))).toBe(1);
});

test("a tap away from every reading, or the chart losing focus, closes a tapped card", () => {
  expect(after(...tap(25), ...tap(null))).toEqual(NO_CHART_HOVER);
  expect(after(...tap(25), { kind: "blur" })).toEqual(NO_CHART_HOVER);
});

test("a touch the browser takes over to scroll the page opens no card, and closes a tapped one", () => {
  const scroll = [
    { kind: "pointer_down", pointer_type: "touch", time_ms: 25 },
    { kind: "pointer_move", pointer_type: "touch", time_ms: 30 },
    { kind: "pointer_cancel", pointer_type: "touch" },
    { kind: "pointer_leave", pointer_type: "touch" },
  ] as const;

  expect(after(...scroll)).toEqual(NO_CHART_HOVER);
  expect(after(...tap(10), ...scroll)).toEqual(NO_CHART_HOVER);
});

test("a pen that cannot hover shows the reading it taps, as a finger does", () => {
  expect(hoveredIndex(STRETCHES, after(...tap(25, "pen")))).toBe(1);
});

test("a mouse shows the reading it rests on and closes the card when it leaves", () => {
  const shown = after({ kind: "pointer_move", pointer_type: "mouse", time_ms: 10 });

  expect(hoveredIndex(STRETCHES, shown)).toBe(0);
  expect(nextChartHover(shown, { kind: "pointer_leave", pointer_type: "mouse" }, STRETCHES)).toEqual(NO_CHART_HOVER);
});

test("the keyboard opens the newest reading and steps through the rest", () => {
  const opened = after({ kind: "focus_visible" });
  const stepped = nextChartHover(opened, { kind: "key", key: "ArrowLeft", modified: false }, STRETCHES);

  expect(hoveredIndex(STRETCHES, opened)).toBe(2);
  expect(hoveredIndex(STRETCHES, stepped)).toBe(1);
  expect(hoveredIndex(STRETCHES, nextChartHover(stepped, { kind: "key", key: "Home", modified: false }, STRETCHES))).toBe(0);
});

test("a key pressed with a modifier is left to the browser", () => {
  const opened = after({ kind: "focus_visible" });

  expect(nextChartHover(opened, { kind: "key", key: "ArrowLeft", modified: true }, STRETCHES)).toEqual(opened);
  expect(nextChartHover(opened, { kind: "key", key: "Escape", modified: true }, STRETCHES)).toEqual(opened);
});

test("after Escape, the Left arrow opens the newest reading rather than skipping it", () => {
  const hover = after({ kind: "focus_visible" }, { kind: "key", key: "Escape", modified: false }, { kind: "key", key: "ArrowLeft", modified: false });

  expect(hoveredIndex(STRETCHES, hover)).toBe(2);
});

test("a pointer leaving, or resting away from every reading, leaves a card the keyboard opened", () => {
  const hover = after(
    { kind: "focus_visible" },
    { kind: "pointer_move", pointer_type: "mouse", time_ms: null },
    { kind: "pointer_leave", pointer_type: "mouse" },
  );

  expect(hoveredIndex(STRETCHES, hover)).toBe(2);
});

test("the card stays with its reading when later readings join that reading's stretch", () => {
  const hover = after({ kind: "focus_visible" });
  // A heartbeat joins the newest reading, which now stands for 30 to 35.
  const grown = [...STRETCHES.slice(0, 2), { first_ms: 30, last_ms: 35 }];

  expect(hoveredIndex(grown, hover)).toBe(2);
  expect(hoveredIndex(STRETCHES.slice(0, 2), hover)).toBe(-1);
});
