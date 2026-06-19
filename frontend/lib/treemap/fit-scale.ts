// Fit heat scale: maps a mean absolute relative error to a color. The ramp runs
// from a deep sage-green (on target) through warm amber to a muted rose (far
// off) — a curated earthy palette rather than neon traffic lights, so the map
// reads as a calm heat surface while still being unmistakably good → bad.

interface Stop {
  at: number; // mean absolute relative error
  rgb: [number, number, number];
}

const STOPS: Stop[] = [
  { at: 0.0, rgb: [38, 140, 120] }, // #268C78 teal-green (on target)
  { at: 0.03, rgb: [86, 162, 108] }, // #56A26C
  { at: 0.06, rgb: [150, 184, 104] }, // #96B868 sage
  { at: 0.1, rgb: [223, 168, 92] }, // #DFA85C warm amber
  { at: 0.2, rgb: [206, 110, 63] }, // #CE6E3F terracotta
  { at: 0.4, rgb: [167, 58, 75] }, // #A73A4B muted rose
];

const MISSING: [number, number, number] = [156, 163, 175]; // slate — no score

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

// A readable contrast color (dark or light) for text laid over a fill.
export function readableInk(error: number | null | undefined): string {
  if (error == null || !Number.isFinite(error)) return "#1f2937";
  // The pale sage/amber band gets dark ink; deeper greens and the rose end get
  // light ink.
  return error >= 0.05 && error <= 0.15 ? "#1f2937" : "#ffffff";
}
