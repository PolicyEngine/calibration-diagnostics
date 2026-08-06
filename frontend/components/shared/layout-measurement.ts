export function stackedLayoutHeight(
  partHeights: number[],
  gap: number,
): number {
  const heights = partHeights.map((height) =>
    Number.isFinite(height) ? Math.max(height, 0) : 0,
  );
  const safeGap = Number.isFinite(gap) ? Math.max(gap, 0) : 0;
  return Math.round(
    heights.reduce((total, height) => total + height, 0) +
      Math.max(heights.length - 1, 0) * safeGap,
  );
}
