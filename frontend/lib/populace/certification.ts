// Certification panel data layer. Gate *execution* (what blocked the build) and
// gate *certification* (what the published evidence proves) are different
// contracts (populace#381). This module normalizes every gate the release
// carries — the build_manifest.gates map plus the coverage/smoke side files —
// into one verdict surface: name, outcome, whether it was enforced, and the
// evidence sha where present.
//
// Today's manifests express a gate as `{ passed: bool, failures, details }`.
// populace#381 will publish an exhaustive report with an explicit
// `outcome ∈ {passed,failed,skipped,waived}`, an `enforced` flag, and an
// `evidence_sha`. normalizeGate reads the richer fields when they exist and
// derives them from the current shape when they don't, so #381 drops in without
// restructuring the panel.

import { asObject } from "./latest-artifact";
import { exclusionsFromMap, type CoverageExclusion } from "./coverage";

type JsonObject = Record<string, unknown>;

// Compact loss for a one-line gate summary: small normalized losses read best
// with a few decimals, larger raw objectives as exponential.
function fmtLossValue(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 1) return value.toFixed(value < 0.001 ? 6 : 4);
  return value.toExponential(2).replace("e+", "e");
}

export type GateOutcome = "passed" | "failed" | "skipped" | "waived" | "unknown";

export type GateSource =
  | "build_manifest"
  | "us_source_coverage"
  | "input_coverage"
  | "reform_coverage_smoke";

export interface CertificationGate {
  key: string;
  label: string;
  outcome: GateOutcome;
  // null = the artifact does not declare enforcement (today's build_manifest
  // gates); populace#381 makes this an explicit bool.
  enforced: boolean | null;
  evidence_sha: string | null;
  failure_count: number;
  failures: string[];
  reviewed_exclusions: CoverageExclusion[];
  // #286 "cannot rot": an exclusion whose column has caught up is stale and
  // should fail the gate. Surfaced so a reviewer sees rot immediately.
  stale_exclusions: string[];
  summary: string | null;
  source: GateSource;
}

export interface ReviewedExclusionRegister {
  gate_key: string;
  gate_label: string;
  entries: CoverageExclusion[];
}

export interface Certification {
  release_id: string;
  gates: CertificationGate[];
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    waived: number;
    enforced: number;
  };
  reviewed_exclusion_registers: ReviewedExclusionRegister[];
  stale_exclusion_count: number;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    : [];
}

const GATE_LABELS: Record<string, string> = {
  calibration: "Calibration",
  target_compilation: "Target compilation",
  target_profile_coverage: "Target profile coverage",
  base_population_scale: "Base population scale",
  health_input_signal: "Health input signal",
  immigration_composition: "Immigration composition",
  degenerate_input_signal: "Degenerate input signal",
  ecps_parity: "eCPS parity",
  hours_worked_signal: "Hours-worked signal",
  snap_take_up_signal: "SNAP take-up signal",
  us_source_coverage: "Source coverage",
  input_coverage: "Input-column coverage",
  reform_coverage_smoke: "Reform-coverage smoke",
};

function gateLabel(key: string): string {
  if (GATE_LABELS[key]) return GATE_LABELS[key];
  return key
    .split("_")
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

const KNOWN_OUTCOMES = new Set<GateOutcome>(["passed", "failed", "skipped", "waived"]);

// The evidence sha lives under a different key depending on the gate; check the
// ones producers actually emit, plus the target-frame checkpoint's identity.
function evidenceSha(raw: JsonObject, details: JsonObject): string | null {
  const checkpoint = asObject(details.target_frame_checkpoint);
  return (
    stringOrNull(raw.evidence_sha) ??
    stringOrNull(raw.sha256) ??
    stringOrNull(raw.identity_sha256) ??
    stringOrNull(details.sha256) ??
    stringOrNull(checkpoint.identity_sha256) ??
    null
  );
}

function deriveOutcome(key: string, raw: JsonObject, details: JsonObject): GateOutcome {
  // populace#381: explicit outcome wins.
  const explicit = stringOrNull(raw.outcome);
  if (explicit && KNOWN_OUTCOMES.has(explicit as GateOutcome)) {
    return explicit as GateOutcome;
  }
  const status = (stringOrNull(raw.status) ?? "").toLowerCase();
  if (status.includes("waiv")) return "waived";
  if (status.includes("skip")) return "skipped";
  if (typeof raw.passed === "boolean") return raw.passed ? "passed" : "failed";
  // target_compilation carries no `passed`; it compiled iff nothing was dropped
  // and every declared target became a candidate.
  if (key === "target_compilation") {
    const declared = numberOrNull(details.declared_targets);
    const compiled = numberOrNull(details.compiled_candidate_targets);
    const dropped = Array.isArray(details.dropped_target_names)
      ? details.dropped_target_names.length
      : 0;
    if (declared != null && compiled != null) {
      return dropped === 0 && compiled >= declared ? "passed" : "failed";
    }
  }
  const failures = stringArray(raw.failures ?? details.failures);
  if (failures.length > 0) return "failed";
  return "unknown";
}

// A short human line so a gate scans without expanding its details.
function gateSummary(key: string, details: JsonObject): string | null {
  switch (key) {
    case "calibration": {
      const loss = numberOrNull(details.final_loss);
      const within = numberOrNull(details.fraction_within_10pct);
      const parts = [
        loss != null ? `loss ${fmtLossValue(loss)}` : null,
        within != null ? `${(within * 100).toFixed(1)}% within 10%` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case "target_compilation": {
      const declared = numberOrNull(details.declared_targets);
      const compiled = numberOrNull(details.compiled_candidate_targets);
      const dropped = Array.isArray(details.dropped_target_names)
        ? details.dropped_target_names.length
        : 0;
      if (declared == null && compiled == null) return null;
      return `${compiled ?? "?"}/${declared ?? "?"} compiled · ${dropped} dropped`;
    }
    case "target_profile_coverage": {
      const reqs = numberOrNull(details.requirements_checked);
      const targets = numberOrNull(details.targets_checked);
      if (reqs == null && targets == null) return null;
      return `${reqs ?? "?"} requirements · ${targets ?? "?"} targets`;
    }
    case "base_population_scale": {
      const pop = numberOrNull(details.population);
      const bench = numberOrNull(details.benchmark);
      const rel = numberOrNull(details.relative_error);
      if (pop == null || bench == null) return null;
      return `${(pop / 1e6).toFixed(1)}M vs ${(bench / 1e6).toFixed(1)}M${rel != null ? ` (${(rel * 100).toFixed(1)}%)` : ""}`;
    }
    case "ecps_parity": {
      const gaps = numberOrNull(details.gaps);
      const exempted = Array.isArray(details.exempted) ? details.exempted.length : null;
      if (gaps == null) return null;
      return `${gaps} gaps${exempted != null ? ` · ${exempted} exempted` : ""}`;
    }
    case "snap_take_up_signal": {
      const share = numberOrNull(details.take_up_share);
      return share != null ? `take-up ${(share * 100).toFixed(1)}%` : null;
    }
    case "hours_worked_signal": {
      const share = numberOrNull(details.worked_share);
      return share != null ? `worked share ${(share * 100).toFixed(1)}%` : null;
    }
    default:
      return null;
  }
}

// #286 stale exclusions across the gate's several possible key names.
function staleExclusions(details: JsonObject): string[] {
  return [
    ...stringArray(details.stale_exclusions),
    ...stringArray(details.unused_reviewed_exclusions),
    ...stringArray(details.unused_exclusions),
  ];
}

export function normalizeGate(
  key: string,
  raw: JsonObject,
  source: GateSource,
): CertificationGate {
  // Gates are inconsistent about nesting: calibration/target_compilation put
  // their metrics at the top level, base_population_scale et al. under a
  // `details` object. Merge both (top level wins) so every reader resolves the
  // field wherever the producer happened to put it.
  const fields = { ...asObject(raw.details), ...raw };
  const failures = stringArray(fields.failures);
  const reviewed = exclusionsFromMap(fields.reviewed_exclusions);
  return {
    key,
    label: gateLabel(key),
    outcome: deriveOutcome(key, raw, fields),
    enforced: typeof raw.enforced === "boolean" ? raw.enforced : null,
    evidence_sha: evidenceSha(raw, fields),
    failure_count: failures.length,
    failures,
    reviewed_exclusions: reviewed,
    stale_exclusions: staleExclusions(fields),
    summary: gateSummary(key, fields),
    source,
  };
}

// Side files (us_source_coverage / input_coverage / reform_coverage_smoke) are
// not represented in build_manifest.gates yet (populace#381). Fold them in so
// the certification surface is exhaustive: a published side file becomes a gate;
// a missing one becomes an honest "skipped — not published" entry.
export interface SideGateInput {
  key: GateSource;
  available: boolean;
  gate?: { passed: boolean | null; failures: string[] } | null;
  enforced?: boolean | null;
  reviewed_exclusions?: CoverageExclusion[];
}

function normalizeSideGate(input: SideGateInput): CertificationGate {
  if (!input.available) {
    return {
      key: input.key,
      label: gateLabel(input.key),
      outcome: "skipped",
      enforced: input.enforced ?? null,
      evidence_sha: null,
      failure_count: 0,
      failures: [],
      reviewed_exclusions: [],
      stale_exclusions: [],
      summary: "not published for this release",
      source: input.key,
    };
  }
  const passed = input.gate?.passed ?? null;
  const failures = input.gate?.failures ?? [];
  return {
    key: input.key,
    label: gateLabel(input.key),
    outcome: passed == null ? "unknown" : passed ? "passed" : "failed",
    enforced: input.enforced ?? null,
    evidence_sha: null,
    failure_count: failures.length,
    failures,
    reviewed_exclusions: input.reviewed_exclusions ?? [],
    stale_exclusions: [],
    summary: null,
    source: input.key,
  };
}

export function buildCertification(
  buildManifest: JsonObject,
  releaseId: string,
  sideGates: SideGateInput[] = [],
): Certification {
  const gatesRaw = asObject(buildManifest.gates);
  const manifestGates = Object.entries(gatesRaw).map(([key, value]) =>
    normalizeGate(key, asObject(value), "build_manifest"),
  );
  const gates = [...manifestGates, ...sideGates.map(normalizeSideGate)];

  const totals = {
    total: gates.length,
    passed: gates.filter((g) => g.outcome === "passed").length,
    failed: gates.filter((g) => g.outcome === "failed").length,
    skipped: gates.filter((g) => g.outcome === "skipped").length,
    waived: gates.filter((g) => g.outcome === "waived").length,
    enforced: gates.filter((g) => g.enforced === true).length,
  };

  const reviewed_exclusion_registers: ReviewedExclusionRegister[] = gates
    .filter((g) => g.reviewed_exclusions.length > 0)
    .map((g) => ({
      gate_key: g.key,
      gate_label: g.label,
      entries: g.reviewed_exclusions,
    }));

  return {
    release_id: releaseId,
    gates,
    totals,
    reviewed_exclusion_registers,
    stale_exclusion_count: gates.reduce((sum, g) => sum + g.stale_exclusions.length, 0),
  };
}
