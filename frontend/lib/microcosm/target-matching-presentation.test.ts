import { describe, expect, test } from "bun:test";

import {
  targetMatchKindExplanation,
  targetRepresentationPairLabel,
} from "./target-matching-presentation";

describe("target matching presentation", () => {
  test("explains each supported match method literally", () => {
    expect(targetMatchKindExplanation("base_name")).toBe(
      "Matched by period-normalized target name.",
    );
    expect(targetMatchKindExplanation("chronicle_fact_key")).toBe(
      "Matched by exact Chronicle fact key.",
    );
    expect(targetMatchKindExplanation("structured_identity")).toContain("provider ID");
    expect(targetMatchKindExplanation(null)).toBe("Not matched across releases.");
  });

  test("formats row representation transitions", () => {
    expect(targetRepresentationPairLabel("legacy", "structured")).toBe(
      "Legacy format → Structured format",
    );
    expect(targetRepresentationPairLabel(null, "structured")).toBe("Structured format");
    expect(targetRepresentationPairLabel("structured", "hierarchy")).toBe(
      "Structured format → Hierarchy format",
    );
  });
});
