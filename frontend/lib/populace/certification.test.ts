import { expect, test } from "bun:test";

import { buildCertification, normalizeGate } from "./certification";

// Trimmed real build_manifest.gates shape (the buildi release): most gates are
// { passed, failures, details }; target_compilation carries no `passed`.
const GATES = {
  calibration: {
    passed: true,
    failures: [],
    final_loss: 0.03083,
    fraction_within_10pct: 0.8888,
  },
  target_compilation: {
    declared_targets: 5514,
    compiled_candidate_targets: 5514,
    dropped_target_names: [],
    target_frame_checkpoint: { identity_sha256: "b2eb410149e9ad16060fdbb9bb" },
  },
  degenerate_input_signal: {
    passed: true,
    failures: [],
    details: {
      columns_checked: 73,
      reviewed_exclusions: {
        s_corp_income: "Combined partnership/S-corp income is carried in partnership_income; see #359.",
        second_home_mortgage_balance: "Second-home decomposition not imputed; tracked in populace#340.",
      },
      stale_exclusions: [],
    },
  },
};

test("a normal gate maps passed:true to outcome 'passed'", () => {
  const gate = normalizeGate("calibration", GATES.calibration, "build_manifest");
  expect(gate.outcome).toBe("passed");
  expect(gate.summary).toContain("within 10%");
  // enforcement is not declared in today's build manifest.
  expect(gate.enforced).toBeNull();
});

test("target_compilation (no `passed`) is derived from dropped/compiled counts", () => {
  const gate = normalizeGate(
    "target_compilation",
    { ...GATES.target_compilation, details: GATES.target_compilation },
    "build_manifest",
  );
  expect(gate.outcome).toBe("passed");
  // the checkpoint identity sha is surfaced as evidence.
  expect(gate.evidence_sha).toBe("b2eb410149e9ad16060fdbb9bb");
});

test("target_compilation with dropped targets fails", () => {
  const raw = {
    declared_targets: 100,
    compiled_candidate_targets: 100,
    dropped_target_names: ["x/y/z"],
    details: {
      declared_targets: 100,
      compiled_candidate_targets: 100,
      dropped_target_names: ["x/y/z"],
    },
  };
  expect(normalizeGate("target_compilation", raw, "build_manifest").outcome).toBe("failed");
});

test("reviewed exclusions are parsed with their linked issues", () => {
  const gate = normalizeGate("degenerate_input_signal", GATES.degenerate_input_signal, "build_manifest");
  expect(gate.reviewed_exclusions).toHaveLength(2);
  const sCorp = gate.reviewed_exclusions.find((e) => e.subject === "s_corp_income")!;
  expect(sCorp.issues[0].number).toBe(359);
});

test("populace#381 fields (explicit outcome/enforced/evidence_sha) win when present", () => {
  const gate = normalizeGate(
    "base_population_scale",
    {
      outcome: "waived",
      enforced: false,
      evidence_sha: "deadbeefcafe0001",
      passed: true, // #381 outcome must override the legacy boolean
      failures: [],
    },
    "build_manifest",
  );
  expect(gate.outcome).toBe("waived");
  expect(gate.enforced).toBe(false);
  expect(gate.evidence_sha).toBe("deadbeefcafe0001");
});

test("a skipped/waived status maps to the right outcome", () => {
  expect(normalizeGate("g", { status: "skipped_checkpoint_hit" }, "build_manifest").outcome).toBe("skipped");
  expect(normalizeGate("g", { status: "waived_by_flag" }, "build_manifest").outcome).toBe("waived");
});

test("stale reviewed exclusions (#286 cannot-rot) are surfaced", () => {
  const gate = normalizeGate(
    "health_input_signal",
    { passed: true, details: { unused_exclusions: ["takes_up_aca_if_eligible"] } },
    "build_manifest",
  );
  expect(gate.stale_exclusions).toEqual(["takes_up_aca_if_eligible"]);
});

test("buildCertification folds side files and tallies totals", () => {
  const cert = buildCertification({ gates: GATES }, "rel-1", [
    {
      key: "us_source_coverage",
      available: true,
      gate: { passed: true, failures: [] },
      enforced: true,
      reviewed_exclusions: [
        { subject: "census-acs-national", reason: "Reviewed exclusion, Issue #40.", issues: [] },
      ],
    },
    { key: "input_coverage", available: false },
    { key: "reform_coverage_smoke", available: false },
  ]);

  // 3 manifest gates + 3 side gates.
  expect(cert.totals.total).toBe(6);
  expect(cert.totals.passed).toBe(4); // calibration, target_compilation, degenerate, source_coverage
  // the two unpublished side files are honestly skipped.
  expect(cert.totals.skipped).toBe(2);
  expect(cert.totals.enforced).toBe(1);
  // registers group reviewed exclusions by gate.
  const gateKeys = cert.reviewed_exclusion_registers.map((r) => r.gate_key).sort();
  expect(gateKeys).toEqual(["degenerate_input_signal", "us_source_coverage"]);
});
