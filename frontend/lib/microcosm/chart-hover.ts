import { pointerHovers } from "@/lib/microcosm/timeline-focus";

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

// The drawn reading whose stretch holds the card's moment, or -1. A reading
// that later readings join keeps the card; one a refresh drops closes it.
export function hoveredIndex(stretches: readonly ChartStretch[], hover: ChartHover): number {
  const time = hover.time_ms;
  if (time == null) return -1;
  return stretches.findIndex((stretch) => stretch.first_ms <= time && time <= stretch.last_ms);
}

function shown(time: number | null, openedBy: ChartHover["opened_by"]): ChartHover {
  return time == null ? NO_CHART_HOVER : { time_ms: time, opened_by: openedBy };
}

// The keys a chart answers; it keeps the browser from also scrolling for them.
export const CHART_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End", "Escape"]);

// The card after one event:
// - a hovering pointer shows the reading it rests near, and closes a card it
//   opened when it rests away from every reading or leaves;
// - a touch shows the reading it lands on and keeps it after the finger
//   lifts, until a tap away from every reading or the chart losing focus;
// - keyboard focus shows the newest reading, the arrows, Home and End step
//   through them (from the newest when no card is open), and Escape closes
//   the card; a pointer leaving does not close a card the keyboard opened.
export function nextChartHover(
  hover: ChartHover,
  event: ChartHoverEvent,
  stretches: readonly ChartStretch[],
): ChartHover {
  const last = stretches.length - 1;
  switch (event.kind) {
    case "pointer_move":
      if (!pointerHovers(event.pointer_type)) return event.time_ms == null ? hover : shown(event.time_ms, "touch");
      if (event.time_ms != null) return shown(event.time_ms, "pointer");
      return hover.opened_by === "pointer" ? NO_CHART_HOVER : hover;
    case "pointer_down":
      if (pointerHovers(event.pointer_type)) return hover;
      return shown(event.time_ms, "touch");
    case "pointer_leave":
      return pointerHovers(event.pointer_type) && hover.opened_by === "pointer" ? NO_CHART_HOVER : hover;
    case "focus_visible":
      return last < 0 ? hover : shown(stretches[last].last_ms, "keyboard");
    case "blur":
      return NO_CHART_HOVER;
    case "key": {
      if (event.key === "Escape") return NO_CHART_HOVER;
      if (last < 0 || !CHART_KEYS.has(event.key)) return hover;
      const current = hoveredIndex(stretches, hover);
      const next =
        current < 0 || event.key === "End"
          ? event.key === "Home"
            ? 0
            : last
          : event.key === "Home"
            ? 0
            : event.key === "ArrowLeft"
              ? Math.max(0, current - 1)
              : Math.min(last, current + 1);
      return shown(stretches[next].last_ms, "keyboard");
    }
  }
}
