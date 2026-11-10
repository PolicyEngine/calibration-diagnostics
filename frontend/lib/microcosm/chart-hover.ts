// Which reading a Timeline chart's hover card shows, and who opened it: a
// hovering pointer (mouse or pen), a touch, or the keyboard. Kept apart from
// the component so each change can be checked without a browser.

// One drawn reading, by the stretch of time it stands for: a single reading's
// own time twice, or a downsampled reading's first and last times.
export interface ChartStretch {
  first_ms: number;
  last_ms: number;
}

export interface ChartHover {
  // A moment inside the shown reading's stretch; null when no card is open.
  time_ms: number | null;
  opened_by: "pointer" | "touch" | "keyboard" | null;
}

export const NO_CHART_HOVER: ChartHover = { time_ms: null, opened_by: null };

export type ChartHoverEvent =
  | { kind: "pointer_move"; pointer_type: string; time_ms: number | null }
  | { kind: "pointer_down"; pointer_type: string; time_ms: number | null }
  | { kind: "pointer_leave"; pointer_type: string }
  | { kind: "focus_visible" }
  | { kind: "blur" }
  | { kind: "key"; key: string };

// The drawn reading whose stretch holds the card's moment, or -1.
export function hoveredIndex(_stretches: readonly ChartStretch[], _hover: ChartHover): number {
  return -1;
}

// The keys a chart answers; it keeps the browser from also scrolling for them.
export const CHART_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End", "Escape"]);

export function nextChartHover(
  hover: ChartHover,
  _event: ChartHoverEvent,
  _stretches: readonly ChartStretch[],
): ChartHover {
  return hover;
}
