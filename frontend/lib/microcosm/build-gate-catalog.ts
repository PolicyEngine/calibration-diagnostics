// Every check the US release build runs, in the order
// tools/build_us_fiscal_refresh_release.py reaches it (PolicyEngine/microcosm
// main @ 3598c38d, 2026-10-01). The build's expensive work sits between the
// positions: target compilation and calibration run after every pre-solve
// check and before every post-solve one, so a post-solve failure is found
// only after hours of compute.
//
// Passing gates emit no telemetry; only failures appear in a run's events, so
// observed failure counts come from run history, not from this list.

export const BUILD_GATE_CATALOG_SOURCE = {
  repo: "PolicyEngine/microcosm",
  commit: "3598c38d",
  path: "tools/build_us_fiscal_refresh_release.py",
};

export type GatePosition = "pre_solve" | "post_solve" | "post_export";

export const GATE_POSITIONS: { id: GatePosition; label: string; detail: string }[] = [
  {
    id: "pre_solve",
    label: "Before target compilation",
    detail: "Runs during input stages, minutes into the build.",
  },
  {
    id: "post_solve",
    label: "After calibration",
    detail: "Runs after target compilation and calibration (about 3.8 h in run 310842b986d7).",
  },
  {
    id: "post_export",
    label: "After the H5 is written",
    detail: "Scores the exported dataset.",
  },
];

export interface CatalogGate {
  stage: string;
  position: GatePosition;
  covers?: string;
}

const PRE_SOLVE = [
  "capital_gains_tail_presence",
  "weeks_unemployed_input_gate",
  "post_selection_weeks_unemployed_input_gate",
  "base_population_gate",
  "qbi_input_gate",
  "farm_business_income_gate",
  "domestic_production_ald_gate",
  "child_support_input_gate",
  "disability_benefits_input_gate",
  "workers_compensation_input_gate",
  "educator_expense_input_gate",
  "form_4952_election_input_gate",
  "salt_refund_income_input_gate",
  "capital_gain_details_input_gate",
  "childcare_input_gate",
  "energy_subsidy_gate",
  "alimony_input_gate",
  "casualty_loss_input_gate",
  "misc_itemized_input_gate",
  "retirement_contribution_inputs_gate",
  "immigration_gate",
  "take_up_gate",
  "hours_worked_gate",
  "snap_take_up_gate",
  "relationship_inputs_gate",
  "spm_independence_role_gate",
  "medicare_take_up_input_gate",
  "prior_year_income_gate",
  "housing_inputs_gate",
  "retirement_distribution_inputs_gate",
  "eligibility_inputs_gate",
  "education_inputs_gate",
  "pregnancy_gate",
  "reported_coverage_vintage_gate",
  "wic_claim_input_gate",
  "snap_discretionary_exemption_gate",
  "scf_wealth_gate",
  "ssi_disability_criteria_gate",
  "sipp_head_start_gate",
  "ssi_take_up_gate",
  "scf_auto_loan_gate",
  "sipp_vehicles_gate",
  "voluntary_filing_gate",
  "sipp_tips_gate",
  "org_wages_gate",
  "health_input_gate",
  "medicaid_take_up_gate",
  "snap_state_take_up_gate",
  "other_health_insurance_input_gate",
  "input_mass_reference_gate",
  "degenerate_input_gate",
  "ecps_parity_gate",
  "base_frame_spm_composition",
];

export const US_RELEASE_GATES: CatalogGate[] = [
  ...PRE_SOLVE.map((stage) => ({ stage, position: "pre_solve" as const })),
  { stage: "ssi_take_up_final_gate", position: "post_solve" },
  {
    stage: "release_gates",
    position: "post_solve",
    covers:
      "One batched refusal: dropped or skipped targets, zero-support, critical-target fit, SOI Table 1.4, calibration loss, take-up finals, input coverage, export input mass, QRF tail-concentration register, stored inputs, and exact-k register fit.",
  },
  { stage: "export_frame_spm_composition", position: "post_solve" },
  { stage: "export_frame_stored_inputs", position: "post_solve" },
  { stage: "ssi_take_up_delivery_gate", position: "post_solve" },
  { stage: "reform_coverage_smoke", position: "post_export" },
  { stage: "post_export_audit", position: "post_export" },
];

// Only the US version 1 release pipeline has a reviewed catalog.
export function gateCatalogForPipeline(pipeline: string): CatalogGate[] | null {
  return pipeline === "US:release-v1" ? US_RELEASE_GATES : null;
}
