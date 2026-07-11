import { expect, test } from "bun:test";

import {
  computeReleaseDelta,
  deltaSlackPayload,
  formatDeltaTable,
  type ComputeDeltaInput,
} from "./deltas";
import type { Calibration } from "./latest-artifact";
import type { ReformValidation } from "./reforms";
import type { Certification } from "./certification";
import type { SourceCoverage } from "./coverage";

function cal(id: string, over: Partial<Calibration>): Calibration {
  return {
    source: "huggingface_live",
    release_id: id,
    updated_at: null,
    schema_version: 2,
    weight_entity: "household",
    options: {},
    l0_lambda: null,
    n_nonzero: 100000,
    n_records: 100000,
    initial_loss: 1,
    final_loss: 0.03,
    loss_kind: "normalized_target_loss",
    fraction_within_10pct: 0.88,
    loss_trajectory: [],
    skipped: [],
    declared_targets: 100,
    compiled_candidate_targets: 100,
    dropped_target_names: [],
    included_target_count: 100,
    build_manifest: {},
    release_manifest: {},
    rows: [],
    ...over,
  };
}

function reforms(rows: { id: string; name: string; absRel: number | null }[]): ReformValidation {
  return {
    available: true,
    source: "huggingface_live",
    release_id: "r",
    updated_at: null,
    schema_version: 1,
    baseline_period: 2026,
    scoring_window: "FY2027",
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: "OBBBA",
      description: null,
      in_sample: false,
      period: 2026,
      jct_score: 1,
      jct_score_fy2026: 1,
      jct_score_type: "conventional",
      jct_window: "FY2027",
      jct_benchmark_window: "FY2027",
      jct_source: null,
      jct_source_url: null,
      jct_published: null,
      populace_estimate: 1,
      populace_window: "FY2027",
      populace_annual: null,
      abs_error: null,
      relative_error: r.absRel,
      abs_relative_error: r.absRel,
      within_10pct: r.absRel == null ? null : r.absRel <= 0.1,
      direction: null,
    })),
    summary: {
      n_reforms: rows.length,
      n_scored: rows.length,
      within_10pct: 0,
      mean_abs_relative_error: null,
      median_abs_relative_error: null,
      n_out_of_sample: rows.length,
      n_out_of_sample_scored: rows.length,
      out_of_sample_within_10pct: 0,
      out_of_sample_mean_abs_relative_error: null,
    },
  };
}

const NOW = new Date("2026-07-09T00:00:00Z");

function run(input: Omit<ComputeDeltaInput, "now">) {
  return computeReleaseDelta({ ...input, now: NOW });
}

test("a loss move beyond its band is flagged and marked 'worse'", () => {
  const report = run({
    a: cal("populace-us-2024-aaa-20260701", { final_loss: 0.03 }),
    b: cal("populace-us-2024-bbb-20260709", { final_loss: 0.08 }),
  });
  const loss = report.headline.find((m) => m.key === "final_loss")!;
  expect(loss.abs_delta).toBeCloseTo(0.05, 6);
  expect(loss.band).toBe("beyond");
  expect(loss.improve).toBe("worse");
  expect(report.flags.some((f) => f.startsWith("Calibration loss moved"))).toBe(true);
});

test("a small loss move stays within band", () => {
  const report = run({
    a: cal("a", { final_loss: 0.03 }),
    b: cal("b", { final_loss: 0.031 }),
  });
  expect(report.headline.find((m) => m.key === "final_loss")!.band).toBe("within");
});

test("within-10% improvement reads as 'better'", () => {
  const report = run({
    a: cal("a", { fraction_within_10pct: 0.88 }),
    b: cal("b", { fraction_within_10pct: 0.889 }),
  });
  const w = report.headline.find((m) => m.key === "fraction_within_10pct")!;
  expect(w.improve).toBe("better");
  expect(w.band).toBe("within");
});

test("a records drop beyond the 5% band is flagged via relative delta", () => {
  const report = run({
    a: cal("a", { n_nonzero: 100000 }),
    b: cal("b", { n_nonzero: 90000 }),
  });
  const records = report.headline.find((m) => m.key === "n_nonzero")!;
  expect(records.rel_delta).toBeCloseTo(-0.1, 6);
  expect(records.band).toBe("beyond");
});

test("a changed target surface makes loss non-comparable and is flagged", () => {
  const report = run({
    a: cal("a", { rows: [{ name: "t1", base_name: "t1", target: 1, final_estimate: 1 }] }),
    b: cal("b", { rows: [] }),
  });
  expect(report.surfaces_differ).toBe(true);
  const loss = report.headline.find((m) => m.key === "final_loss")!;
  expect(loss.comparable).toBe(false);
  expect(loss.band).toBeNull();
  expect(report.flags.some((f) => f.startsWith("Target surface changed"))).toBe(true);
});

test("reform validation deltas match by id and flag beyond-band moves", () => {
  const report = run({
    a: cal("a", {}),
    b: cal("b", {}),
    reformA: reforms([{ id: "obbba_salt", name: "SALT limit", absRel: 0.05 }]),
    reformB: reforms([{ id: "obbba_salt", name: "SALT limit", absRel: 0.2 }]),
  });
  expect(report.reforms_available).toBe(true);
  const row = report.reforms.find((r) => r.id === "obbba_salt")!;
  expect(row.delta).toBeCloseTo(0.15, 6);
  expect(row.band).toBe("beyond");
  expect(report.flags.some((f) => f.includes("SALT limit"))).toBe(true);
});

test("reforms_available is false when one side never published", () => {
  const report = run({
    a: cal("a", {}),
    b: cal("b", {}),
    reformA: reforms([{ id: "x", name: "X", absRel: 0.05 }]),
    reformB: null,
  });
  expect(report.reforms_available).toBe(false);
  expect(report.reforms).toHaveLength(0);
});

test("a coverage shrink is detected and flagged", () => {
  const coverage = (covered: number, missing: number): SourceCoverage =>
    ({
      available: true,
      summary: {
        covered_aliases: covered,
        missing_aliases: missing,
        reviewed_excluded_aliases: 0,
      },
    }) as unknown as SourceCoverage;
  const report = run({
    a: cal("a", {}),
    b: cal("b", {}),
    coverageA: coverage(25, 0),
    coverageB: coverage(20, 3),
  });
  expect(report.coverage_delta?.shrank).toBe(true);
  expect(report.flags.some((f) => f.startsWith("Source coverage shrank"))).toBe(true);
});

test("a gate that was passing and is now waived is flagged as a loss of assurance", () => {
  const cert = (outcome: string): Certification =>
    ({
      release_id: "r",
      gates: [
        {
          key: "ecps_parity",
          label: "eCPS parity",
          outcome,
          source: "build_manifest",
          reviewed_exclusions: [],
          stale_exclusions: [],
          failures: [],
          failure_count: 0,
          enforced: true,
          evidence_sha: null,
          summary: null,
        },
      ],
      totals: { total: 1, passed: 0, failed: 0, skipped: 0, waived: 0, enforced: 1 },
      reviewed_exclusion_registers: [],
      stale_exclusion_count: 0,
    }) as unknown as Certification;
  const report = run({
    a: cal("a", {}),
    b: cal("b", {}),
    certA: cert("passed"),
    certB: cert("waived"),
  });
  expect(report.gate_changes).toHaveLength(1);
  expect(report.gate_changes[0].kind).toBe("waived");
  expect(report.flags.some((f) => f.includes("eCPS parity"))).toBe(true);
});

test("formatDeltaTable and deltaSlackPayload render the report", () => {
  const report = run({
    a: cal("a", { final_loss: 0.03 }),
    b: cal("b", { final_loss: 0.08 }),
  });
  const table = formatDeltaTable(report);
  expect(table).toContain("Calibration loss");
  expect(table).toContain("flags:");
  const payload = deltaSlackPayload(report, { dashboardUrl: "https://example.test/compare" });
  expect(payload.blocks.length).toBeGreaterThanOrEqual(2);
  expect(payload.text).toContain("Populace");
});

test("no flags when everything moves within band", () => {
  const report = run({
    a: cal("a", { final_loss: 0.03, fraction_within_10pct: 0.88, n_nonzero: 100000 }),
    b: cal("b", { final_loss: 0.031, fraction_within_10pct: 0.882, n_nonzero: 100500 }),
  });
  expect(report.flags).toHaveLength(0);
  expect(formatDeltaTable(report)).toContain("within its band");
});
