import comparisonScorecardData from "@/data/populace/latest/comparison_scorecard.json";

type JsonObject = Record<string, unknown>;

const SCORECARD = comparisonScorecardData as JsonObject;

export const POPULACE_COMPARISON_SNAPSHOT_PATH =
  "frontend/data/populace/latest/comparison_scorecard.json";

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// The archived comparison's summary mixes the clean per-target win/loss block
// (target_diagnostics_summary) with the refit/loss scalars (summary). Normalize
// to the flat shape the dashboard and the proposed benchmarks scorecard share
// (PolicyEngine/populace-benchmarks#3), so the live artifact drops in unchanged.
export function normalizeComparisonScorecard(raw: JsonObject): JsonObject {
  const summary = asObject(raw.summary);
  const tdSummary = asObject(raw.target_diagnostics_summary);
  const flat = {
    candidate_loss: numberOrNull(
      tdSummary.candidate_loss ?? summary.candidate_enhanced_cps_native_loss,
    ),
    baseline_loss: numberOrNull(
      tdSummary.baseline_loss ?? summary.baseline_enhanced_cps_native_loss,
    ),
    loss_delta: numberOrNull(
      tdSummary.loss_delta ?? summary.enhanced_cps_native_loss_delta,
    ),
    candidate_holdout_loss: numberOrNull(summary.candidate_holdout_loss),
    baseline_holdout_loss: numberOrNull(summary.baseline_holdout_loss),
    candidate_train_loss: numberOrNull(summary.candidate_train_loss),
    baseline_train_loss: numberOrNull(summary.baseline_train_loss),
    candidate_unweighted_msre: numberOrNull(summary.candidate_unweighted_msre),
    baseline_unweighted_msre: numberOrNull(summary.baseline_unweighted_msre),
    candidate_wins: numberOrNull(tdSummary.candidate_wins ?? summary.candidate_wins),
    baseline_wins: numberOrNull(tdSummary.baseline_wins ?? summary.baseline_wins),
    ties: numberOrNull(tdSummary.ties ?? summary.ties),
    n_targets: numberOrNull(tdSummary.n_targets ?? summary.n_targets_total),
    holdout_targets: numberOrNull(tdSummary.holdout_targets ?? summary.holdout_targets),
    train_targets: numberOrNull(tdSummary.train_targets),
    candidate_beats_baseline:
      typeof summary.candidate_beats_baseline === "boolean"
        ? summary.candidate_beats_baseline
        : null,
    // The archived summary's matched_household_count is a stray bool; the real
    // matched count is the per-dataset household count.
    matched_household_count:
      numberOrNull(summary.matched_household_count) ??
      numberOrNull(summary.candidate_household_count) ??
      numberOrNull(summary.baseline_household_count),
  };
  return {
    release_id: raw.candidate_release_id ?? raw.release_id ?? null,
    incumbent_manifest: raw.incumbent_manifest ?? "pinned-production-ecps-2024",
    period: numberOrNull(raw.period),
    baseline_label: raw.baseline_label ?? "enhanced_cps",
    candidate_label: raw.candidate_label ?? "populace",
    protocol:
      typeof raw.protocol === "string"
        ? raw.protocol
        : flat.matched_household_count != null
          ? `Matched ${flat.matched_household_count.toLocaleString()} households, symmetric refit, ${flat.holdout_targets ?? "?"}-target holdout.`
          : null,
    summary: flat,
    family_breakdown: Array.isArray(raw.family_breakdown) ? raw.family_breakdown : [],
    top_improvements: Array.isArray(raw.top_improvements) ? raw.top_improvements : [],
    top_regressions: Array.isArray(raw.top_regressions) ? raw.top_regressions : [],
    gates: asObject(raw.gates),
  };
}

export function snapshotComparisonScorecard() {
  return {
    available: true,
    source: "deployed_static_snapshot",
    path: POPULACE_COMPARISON_SNAPSHOT_PATH,
    ...normalizeComparisonScorecard(SCORECARD),
  };
}
