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
  // First key wins, searching the per-target win/loss block before the
  // refit/loss scalars — so the flat benchmarks scorecard (everything in
  // ``summary``) and the archived ``sound_ecps_replacement_comparison`` (split
  // across ``summary`` and ``target_diagnostics_summary``) both normalize.
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      for (const source of [tdSummary, summary]) {
        const value = numberOrNull(source[key]);
        if (value != null) return value;
      }
    }
    return null;
  };
  const flat = {
    candidate_loss: pick("candidate_loss", "candidate_enhanced_cps_native_loss"),
    baseline_loss: pick("baseline_loss", "baseline_enhanced_cps_native_loss"),
    loss_delta: pick("loss_delta", "enhanced_cps_native_loss_delta"),
    candidate_holdout_loss: pick("candidate_holdout_loss"),
    baseline_holdout_loss: pick("baseline_holdout_loss"),
    candidate_train_loss: pick("candidate_train_loss"),
    baseline_train_loss: pick("baseline_train_loss"),
    candidate_unweighted_msre: pick("candidate_unweighted_msre"),
    baseline_unweighted_msre: pick("baseline_unweighted_msre"),
    candidate_wins: pick("candidate_wins"),
    baseline_wins: pick("baseline_wins"),
    ties: pick("ties"),
    n_targets: pick("n_targets", "n_targets_total"),
    holdout_targets: pick("holdout_targets"),
    train_targets: pick("train_targets"),
    candidate_beats_baseline:
      typeof summary.candidate_beats_baseline === "boolean"
        ? summary.candidate_beats_baseline
        : null,
    // The archived summary's matched_household_count is a stray bool; the real
    // matched count is the per-dataset household count.
    matched_household_count: pick(
      "matched_household_count",
      "candidate_household_count",
      "baseline_household_count",
    ),
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
