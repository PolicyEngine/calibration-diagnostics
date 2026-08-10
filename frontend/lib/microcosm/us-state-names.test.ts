import { describe, expect, test } from "bun:test";

import { usStateName } from "./us-state-names";

describe("usStateName", () => {
  test("expands state and district abbreviations", () => {
    expect(usStateName("CA")).toBe("California");
    expect(usStateName("DC")).toBe("District of Columbia");
  });

  test("normalizes abbreviation case and supports territories", () => {
    expect(usStateName("ny")).toBe("New York");
    expect(usStateName("PR")).toBe("Puerto Rico");
  });

  test("leaves full or unknown geography labels unchanged", () => {
    expect(usStateName("United States")).toBe("United States");
    expect(usStateName("North region")).toBe("North region");
    expect(usStateName(null)).toBe("");
  });
});
