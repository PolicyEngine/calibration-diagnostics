import { describe, expect, test } from "bun:test";

import {
  classifyTargetRow,
  classifyTargetRepresentation,
  isCompleteStructuredTarget,
  isLegacyTarget,
} from "./target-representation";

const structured = {
  source: { id: "novastat" },
  variable: { id: "population" },
  dimensions: {},
};

describe("calibration target representation", () => {
  test("reports unknown when there are no target rows", () => {
    expect(classifyTargetRepresentation([])).toBe("unknown");
  });

  test("classifies rows without structured identity fields as legacy", () => {
    const rows = [
      { name: "irs.population.total", source: "IRS SOI" },
      { name: "state/ca/population", variable: "population" },
    ];
    expect(rows.every(isLegacyTarget)).toBe(true);
    expect(classifyTargetRepresentation(rows)).toBe("legacy");
  });

  test("requires complete structured identity on every structured row", () => {
    expect(isCompleteStructuredTarget(structured)).toBe(true);
    expect(isCompleteStructuredTarget({ ...structured, dimensions: undefined })).toBe(false);
    expect(isCompleteStructuredTarget({ ...structured, source: { label: "Nova" } })).toBe(false);
    expect(isCompleteStructuredTarget({ ...structured, variable: { id: " " } })).toBe(false);
  });

  test("classifies complete structured rows independently of diagnostics schema", () => {
    expect(classifyTargetRepresentation([
      { ...structured, schema_version: 5 },
      { ...structured, schema_version: 6 },
    ])).toBe("structured");
  });

  test("classifies a collection containing complete structured and legacy rows as mixed", () => {
    expect(classifyTargetRepresentation([
      structured,
      { name: "irs.population.total", source: "IRS SOI" },
    ])).toBe("mixed");
  });

  test("rejects partially structured rows", () => {
    expect(() => classifyTargetRow({
      source: { id: "novastat" },
      variable: "population",
    })).toThrow("complete structured identity fields or legacy fields");
  });
});
