import { expect, test } from "bun:test";

import { squarify } from "./squarify";

const RECT = { x: 0, y: 0, w: 100, h: 100 };

test("tiles fill the whole rectangle by area", () => {
  const placed = squarify(
    [
      { value: 6, data: "a" },
      { value: 6, data: "b" },
      { value: 4, data: "c" },
      { value: 3, data: "d" },
      { value: 1, data: "e" },
    ],
    RECT,
  );
  const area = placed.reduce((sum, p) => sum + p.w * p.h, 0);
  expect(area).toBeCloseTo(100 * 100, 3);
  // Each cell's area is proportional to its value.
  const total = 20;
  for (const p of placed) {
    expect(p.w * p.h).toBeCloseTo((p.value / total) * 100 * 100, 2);
  }
});

test("cells stay inside the bounds", () => {
  const placed = squarify(
    Array.from({ length: 12 }, (_, i) => ({ value: i + 1, data: i })),
    RECT,
  );
  for (const p of placed) {
    expect(p.x).toBeGreaterThanOrEqual(-1e-6);
    expect(p.y).toBeGreaterThanOrEqual(-1e-6);
    expect(p.x + p.w).toBeLessThanOrEqual(100 + 1e-6);
    expect(p.y + p.h).toBeLessThanOrEqual(100 + 1e-6);
  }
});

test("squarified cells keep reasonable aspect ratios", () => {
  const placed = squarify(
    Array.from({ length: 8 }, (_, i) => ({ value: 8 - i, data: i })),
    { x: 0, y: 0, w: 200, h: 100 },
  );
  // No cell should be an extreme sliver — slice-and-dice would produce 20:1.
  for (const p of placed) {
    const ratio = Math.max(p.w / p.h, p.h / p.w);
    expect(ratio).toBeLessThan(6);
  }
});

test("zero-value and empty inputs produce no cells", () => {
  expect(squarify([], RECT)).toHaveLength(0);
  expect(squarify([{ value: 0, data: "x" }], RECT)).toHaveLength(0);
});
