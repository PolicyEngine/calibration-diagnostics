import { describe, expect, test } from "bun:test";

import {
  targetMatchingSummaryText,
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
    expect(targetMatchKindExplanation("structured_identity")).toContain(
      "structured source ID",
    );
    expect(targetMatchKindExplanation(null)).toBe("Not matched across releases.");
  });

  test("formats row representation transitions", () => {
    expect(targetRepresentationPairLabel("legacy", "structured")).toBe(
      "Legacy format → Structured format",
    );
    expect(targetRepresentationPairLabel(null, "structured")).toBe("Structured format");
  });

  test("summarizes match counts and ambiguous identity groups", () => {
    expect(targetMatchingSummaryText({
      current_representation: "legacy",
      candidate_representation: "mixed",
      matched_by: {
        base_name: 4_000,
        chronicle_fact_key: 150,
        structured_identity: 25,
      },
      ambiguous_key_groups: {
        base_name: 1,
        chronicle_fact_key: 0,
        structured_identity: 0,
      },
    })).toBe(
      "Legacy format current release → Mixed formats candidate. Matched 4,000 by normalized target name, 150 by Chronicle fact key, and 25 by structured identity. 1 ambiguous identity group was left unmatched.",
    );
  });
});
