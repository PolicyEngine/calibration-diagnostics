// Fit heat scale: maps a mean absolute relative error to a color. The ramp is
// anchored to the ui-kit / populace.dev palette so the map reads as part of the
// same design system — on-target cells carry the site's PolicyEngine teal, the
// far-off end lands on the ui-kit error red, and unscored cells use ui-kit gray.
// The warm midpoints keep the surface reading as a calm good → bad heat map
// rather than neon traffic lights. Anchors are pre-resolved to RGB because the
// ramp interpolates numerically; each stop names the ui-kit token it draws from.

interface Stop {
  at: number; // mean absolute relative error
  rgb: [number, number, number];
}

const STOPS: Stop[] = [
  { at: 0.0, rgb: [44, 122, 123] }, // --primary   #2C7A7B teal-600 (on target)
  { at: 0.03, rgb: [49, 151, 149] }, // --chart-1   #319795 teal-500
  { at: 0.06, rgb: [150, 184, 104] }, // sage transition
  { at: 0.1, rgb: [223, 168, 92] }, // warm amber
  { at: 0.2, rgb: [206, 110, 63] }, // terracotta
  { at: 0.4, rgb: [185, 28, 28] }, // --text-error #B91C1C (far off)
];

const MISSING: [number, number, number] = [148, 163, 184]; // --color-gray-400 #94A3B8 — no score

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function fitColor(error: number | null | undefined): string {
  if (error == null || !Number.isFinite(error)) return toHex(MISSING);
  const e = Math.max(0, error);
  if (e <= STOPS[0].at) return toHex(STOPS[0].rgb);
  for (let i = 1; i < STOPS.length; i += 1) {
    if (e <= STOPS[i].at) {
      const prev = STOPS[i - 1];
      const next = STOPS[i];
      const t = (e - prev.at) / (next.at - prev.at);
      return toHex([
        lerp(prev.rgb[0], next.rgb[0], t),
        lerp(prev.rgb[1], next.rgb[1], t),
        lerp(prev.rgb[2], next.rgb[2], t),
      ]);
    }
  }
  return toHex(STOPS[STOPS.length - 1].rgb);
}

// Legend ticks shown under the map.
export const FIT_LEGEND: { error: number; label: string }[] = [
  { error: 0.0, label: "0%" },
  { error: 0.05, label: "5%" },
  { error: 0.1, label: "10%" },
  { error: 0.2, label: "20%" },
  { error: 0.4, label: "40%+" },
];

// A readable contrast ink (dark or light) for text laid over a heat fill.
// Returned as ui-kit tokens (applied via inline `color`), so even the map's
// overlay text stays in the design system.
export function readableInk(error: number | null | undefined): string {
  if (error == null || !Number.isFinite(error)) return "var(--foreground)";
  // The pale sage/amber band gets dark ink; deeper greens and the rose end get
  // light ink.
  return error >= 0.05 && error <= 0.15
    ? "var(--foreground)"
    : "var(--text-inverse)";
}
