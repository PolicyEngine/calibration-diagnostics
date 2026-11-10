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

test("a tap shows the reading under it, and lifting the finger keeps it shown", () => {
  const hover = after(
    { kind: "pointer_down", pointer_type: "touch", time_ms: 25 },
    { kind: "pointer_leave", pointer_type: "touch" },
  );

  expect(hoveredIndex(STRETCHES, hover)).toBe(1);
});

test("a tap away from every reading, or the chart losing focus, closes a tapped card", () => {
  const tapped = { kind: "pointer_down", pointer_type: "touch", time_ms: 25 } as const;

  expect(after(tapped, { kind: "pointer_down", pointer_type: "touch", time_ms: null })).toEqual(NO_CHART_HOVER);
  expect(after(tapped, { kind: "blur" })).toEqual(NO_CHART_HOVER);
});

test("a mouse shows the reading it rests on and closes the card when it leaves", () => {
  const shown = after({ kind: "pointer_move", pointer_type: "mouse", time_ms: 10 });

  expect(hoveredIndex(STRETCHES, shown)).toBe(0);
  expect(nextChartHover(shown, { kind: "pointer_leave", pointer_type: "mouse" }, STRETCHES)).toEqual(NO_CHART_HOVER);
});

test("the keyboard opens the newest reading and steps through the rest", () => {
  const opened = after({ kind: "focus_visible" });
  const stepped = nextChartHover(opened, { kind: "key", key: "ArrowLeft" }, STRETCHES);

  expect(hoveredIndex(STRETCHES, opened)).toBe(2);
  expect(hoveredIndex(STRETCHES, stepped)).toBe(1);
  expect(hoveredIndex(STRETCHES, nextChartHover(stepped, { kind: "key", key: "Home" }, STRETCHES))).toBe(0);
});

test("after Escape, the Left arrow opens the newest reading rather than skipping it", () => {
  const hover = after({ kind: "focus_visible" }, { kind: "key", key: "Escape" }, { kind: "key", key: "ArrowLeft" });

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
