import { expect, test } from "bun:test";

import { scaleTicks } from "@/lib/microcosm/chart-scale";

test("ticks fall on round steps of 1, 2, 2.5 or 5 times a power of ten, from 0 up to the scale's top", () => {
  // Memory in GB: a 128 GiB Modal request, and a 512 GiB machine.
  expect(scaleTicks(137.4)).toEqual([0, 50, 100]);
  expect(scaleTicks(549.8)).toEqual([0, 200, 400]);
  // CPU in percent.
  expect(scaleTicks(105)).toEqual([0, 50, 100]);
  expect(scaleTicks(100)).toEqual([0, 25, 50, 75, 100]);
  expect(scaleTicks(40)).toEqual([0, 10, 20, 30, 40]);
  expect(scaleTicks(3.2)).toEqual([0, 1, 2, 3]);
});

test("small scales keep round ticks without floating-point drift", () => {
  expect(scaleTicks(0.3)).toEqual([0, 0.1, 0.2, 0.3]);
  expect(scaleTicks(0.07)).toEqual([0, 0.02, 0.04, 0.06]);
});

test("an empty or unknown scale has only 0", () => {
  expect(scaleTicks(0)).toEqual([0]);
  expect(scaleTicks(Number.NaN)).toEqual([0]);
});
