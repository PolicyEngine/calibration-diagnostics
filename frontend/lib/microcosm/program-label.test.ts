import { describe, expect, test } from "bun:test";

import { programLabel } from "./program-label";

describe("programLabel", () => {
  test("uses exact, curated labels for known program identifiers", () => {
    expect(programLabel("eitc")).toBe("EITC");
    expect(programLabel("ctc")).toBe("CTC");
    expect(programLabel("agi")).toBe("AGI");
  });

  test("sentence-cases ordinary canonical identifiers", () => {
    expect(programLabel("taxable_interest_income")).toBe(
      "Taxable interest income",
    );
    expect(programLabel("adjusted gross income")).toBe(
      "Adjusted gross income",
    );
    expect(programLabel("ordinary-dividend-income")).toBe(
      "Ordinary dividend income",
    );
  });

  test("does not guess that an unknown short identifier is an acronym", () => {
    expect(programLabel("xyz")).toBe("Xyz");
  });

  test("prefers an explicit artifact label when one becomes available", () => {
    expect(programLabel("eitc", "Earned Income Tax Credit")).toBe(
      "Earned Income Tax Credit",
    );
  });
});
