// Tick values for a chart's value axis, from 0 up to `max`: round steps of 1,
// 2, 2.5 or 5 times a power of ten, at most about `intervals` of them, each
// rounded to its step so small scales read 0.1 and not 0.30000000000000004.
export function scaleTicks(max: number, intervals = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((nice) => raw / magnitude <= nice + 1e-9) ?? 10) * magnitude;
  const decimals = Math.max(0, 1 - Math.floor(Math.log10(step)));
  const ticks: number[] = [];
  for (let index = 0; index * step <= max * (1 + 1e-9); index += 1) {
    ticks.push(Number((index * step).toFixed(decimals)));
  }
  return ticks;
}
