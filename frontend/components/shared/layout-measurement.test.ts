import { describe, expect, test } from "bun:test";

import { stackedLayoutHeight } from "./layout-measurement";

describe("stackedLayoutHeight", () => {
  test("includes every row and each gap between rows", () => {
    expect(stackedLayoutHeight([76, 40], 20)).toBe(136);
    expect(stackedLayoutHeight([96, 72], 20)).toBe(188);
    expect(stackedLayoutHeight([76], 20)).toBe(76);
  });

  test("sanitizes invalid measurements", () => {
    expect(stackedLayoutHeight([76, -10, Number.NaN], -4)).toBe(76);
  });
});
