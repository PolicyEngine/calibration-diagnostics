// The populace-US dataset-creation pipeline, as implemented in
// PolicyEngine/populace (derived from main @ 98d990b, 2026-07-02).
//
// Structure mirrors the code, not an idealized diagram:
// - Source enrichment stages come verbatim from
//   packages/populace-build/src/populace/build/us/source_stages.json — the
//   registry of imputation stages baked into the base H5.
// - Build steps carry the exact telemetry stage ids that
//   tools/build_us_fiscal_refresh_release.py emits, so they match what the
//   Staging runs page shows live while a build runs.
// - Publish steps come from populace-data's publish_cli.

export const PIPELINE_SOURCE = {
  repo: "PolicyEngine/populace",
  commit: "98d990b",
  url: "https://github.com/PolicyEngine/populace",
};

export interface SourceStage {
  stage: string;
  survey: string;
  outputs: string[];
}

// packages/populace-build/src/populace/build/us/source_stages.json
export const SOURCE_STAGES: SourceStage[] = [
  {
    stage: "puf_tax_detail",
    survey: "IRS PUF 2015 (uprated)",
    outputs: [
      "employment_income_before_lsr",
      "self_employment_income_before_lsr",
      "taxable_interest_income",
      "dividend_income",
      "capital gains & other tax detail…",
    ],
  },
  {
    stage: "scf_wealth",
    survey: "Fed SCF 2022",
    outputs: ["net_worth", "scf_* assets & debts (housing, retirement, business…)"],
  },
  { stage: "sipp_tips", survey: "Census SIPP", outputs: ["tip_income"] },
  {
    stage: "org_wages",
    survey: "CPS ORG",
    outputs: [
      "hourly_wage",
      "is_paid_hourly",
      "is_union_member_or_covered",
      "fsla_overtime_premium",
    ],
  },
  {
    stage: "meps_esi_premiums",
    survey: "MEPS-IC",
    outputs: ["employer_sponsored_insurance_premiums"],
  },
  {
    stage: "prior_year_income",
    survey: "CPS ASEC (prior year)",
    outputs: ["employment_income_last_year", "self_employment_income_last_year"],
  },
  {
    stage: "mortgage_conversion",
    survey: "IRS PUF 2015 (uprated)",
    outputs: ["deductible_mortgage_interest", "home_mortgage_interest", "mortgage_principal…"],
  },
  { stage: "acs_rent", survey: "Census ACS 2022", outputs: ["pre_subsidy_rent"] },
  {
    stage: "vehicle_assets",
    survey: "Census SIPP",
    outputs: ["household_vehicles_owned", "household_vehicles_value"],
  },
  {
    stage: "aca_marketplace_inputs",
    survey: "CPS ASEC + CMS Marketplace",
    outputs: ["takes_up_aca_if_eligible", "selected_marketplace_plan_benchmark_ratio"],
  },
];

export interface PipelineStep {
  // Matches the staging telemetry stage id where one exists.
  id: string;
  title: string;
  code: string;
  description: string;
  artifacts?: string[];
  note?: string;
}

export interface PipelinePhase {
  key: string;
  title: string;
  summary: string;
  steps: PipelineStep[];
}

export const PIPELINE_PHASES: PipelinePhase[] = [
  {
    key: "inputs",
    title: "Inputs",
    summary:
      "A fiscal-refresh build starts from the previous release and recalibrates household weights — it does not re-run the source enrichment stages above.",
    steps: [
      {
        id: "base_h5",
        title: "Prior release H5",
        code: "build_us_fiscal_refresh_release._download_base_h5",
        description:
          "policyengine/populace-us · populace_us_2024.h5 — the previous release is the base population (records, imputations, and structure are inherited; only weights are refit).",
      },
      {
        id: "ledger_facts",
        title: "Ledger facts",
        code: "--ledger-facts consumer_facts.jsonl",
        description:
          "Sourced official statistics (IRS SOI, Census PEP/STC, CMS, USDA, HHS, SSA, CBO, JCT) exported from the Ledger. These carry the target values.",
      },
      {
        id: "target_references",
        title: "Value-free target references",
        code: "populace/build/us/fiscal_target_references.json",
        description:
          "Declares which target rows exist and how each maps to model variables; joined with Ledger facts to obtain values.",
      },
      {
        id: "validation_configs",
        title: "Validation configs",
        code: "obbba_reforms.json · tax_expenditure_reforms.json · soi_baseline_levels.json",
        description:
          "Out-of-sample benchmark sets: OBBBA provisions vs JCT (stacked, per measure group), tax-expenditure repeals, and SOI baseline levels.",
      },
    ],
  },
  {
    key: "targets",
    title: "Target compilation",
    summary: "References × Ledger facts become the calibration target surface.",
    steps: [
      {
        id: "target_compilation",
        title: "Compile target registry",
        code: "populace.build.us_runtime.fiscal_targets.compile_us_fiscal_target_registry",
        description:
          "Joins the value-free references with Ledger fact values into ~6,900 TargetSpecs across 11 source families (national, state, and congressional-district levels).",
      },
      {
        id: "target_profile_gate",
        title: "Target-profile coverage gate",
        code: "target_profile_coverage_gate",
        description:
          "Refuses to build if required target coverage (per-family requirements, e.g. each JCT tax-expenditure reform) is missing from the compiled surface.",
      },
    ],
  },
  {
    key: "frame",
    title: "Base frame preparation",
    summary: "Load the weighted sampling frame and repair known mass issues before calibration.",
    steps: [
      {
        id: "load_base_frame",
        title: "Load base frame",
        code: "populace.frame.Frame ← H5",
        description: "The prior release's entity tables become a Frame (weighted records with links).",
      },
      {
        id: "base_population_repair",
        title: "Population mass repair + gate",
        code: "_with_base_population_mass_repair · _base_population_scale_gate",
        description:
          "Rescales household weights to the Census national person-population benchmark, then gates that total population is within tolerance.",
      },
      {
        id: "social_security_component_repair",
        title: "Social Security component repair",
        code: "_with_social_security_component_value_repair",
        description: "Repairs SS component value support so SSA component targets are materializable.",
      },
      {
        id: "health_input_gate",
        title: "Health input gate",
        code: "_health_input_signal_gate",
        description: "Verifies health coverage inputs carry signal before calibrating health targets.",
      },
    ],
  },
  {
    key: "materialize",
    title: "Target materialization",
    summary: "Every target becomes a computable column over the frame.",
    steps: [
      {
        id: "target_registry",
        title: "Materialize the target matrix",
        code: "_load_or_materialize_target_frame (batched policyengine-us microsimulations)",
        description:
          "Runs PE-US in batches to compute each target's per-record contribution (the sparse constraint matrix). Cached / checkpointable; congressional-district targets are support-gated.",
      },
    ],
  },
  {
    key: "calibrate",
    title: "Calibration",
    summary: "Reweight households so the frame reproduces the target surface.",
    steps: [
      {
        id: "calibrating",
        title: "Calibrate weights",
        code: "populace.calibrate.calibrate / calibrate_l0_refit",
        description:
          "Torch on log-weights: capped weighted-MAPE loss, mass=conserve, hard max-weight-ratio guard (5×). Optional L0 sparse-support refit. The loss trajectory streams to staging telemetry live.",
      },
      {
        id: "release_gates",
        title: "Release gates",
        code: "post-calibration gates",
        description: "Post-calibration checks (fit, weights, coverage) recorded in the build manifest.",
      },
    ],
  },
  {
    key: "artifacts",
    title: "Export & release artifacts",
    summary: "The dataset plus every diagnostics artifact the dashboard reads.",
    steps: [
      {
        id: "export_dataset",
        title: "Export dataset",
        code: "PE-US H5 writer (round-trip verified)",
        description: "Writes populace_us_2024.h5 with the calibrated weights.",
        artifacts: ["populace_us_2024.h5"],
      },
      {
        id: "write_calibration_npz",
        title: "Calibration package",
        code: "_write_npz",
        description: "Weights, targets, and estimates for reproducibility.",
        artifacts: ["populace_us_2024_calibration.npz"],
      },
      {
        id: "post_export_audit",
        title: "Post-export audit (opt-in)",
        code: "--audit-export-targets",
        description:
          "Slow audit that re-materializes targets from the exported H5; default builds rely on the writer round-trip check instead.",
      },
      {
        id: "reform_validation",
        title: "Reform validation",
        code: "populace.build.us_runtime.reform_validation",
        description:
          "Out-of-sample tests: OBBBA provisions stacked per measure group vs JCT (FY2026 + FY2027), tax-expenditure repeals, and SOI baseline levels (one shared baseline sim).",
        artifacts: ["reform_validation.json"],
      },
      {
        id: "demographics",
        title: "Demographics",
        code: "populace.build.us.demographics",
        description: "Age-distribution snapshot vs the Census benchmark.",
        artifacts: ["demographics.json"],
      },
      {
        id: "source_coverage",
        title: "Source coverage + diagnostics",
        code: "populace.calibrate.diagnostics.write_calibration_diagnostics",
        description: "Per-target fit for every calibration target, plus the source-coverage map.",
        artifacts: ["calibration_diagnostics.json", "us_source_coverage.json"],
      },
      {
        id: "manifests",
        title: "Manifests",
        code: "_build_manifests",
        description:
          "Build manifest (code SHA, timing, gates, staging run id) and release manifest (artifact SHAs, compatible package versions).",
        artifacts: ["build_manifest.json", "release_manifest.json"],
      },
    ],
  },
  {
    key: "staging",
    title: "Staging (live, on by default)",
    summary: "Telemetry streams to the staging repo while the build runs.",
    steps: [
      {
        id: "staging_telemetry",
        title: "Staging telemetry",
        code: "populace.build.staging.StagingTelemetry → policyengine/populace-us-staging",
        description:
          "Progress, events, the calibration loss curve, and every artifact above upload live (best-effort, never fails a build). Candidates are reviewable on this dashboard — the Staging runs page, and as 'candidate' entries in Target diagnostics and Reform validation — before publishing.",
      },
    ],
  },
  {
    key: "publish",
    title: "Publish",
    summary: "A guarded, manual step on the build machine.",
    steps: [
      {
        id: "publish_release",
        title: "populace-publish-release",
        code: "populace.data.publish_cli (tools/publish_release.sh wrapper)",
        description:
          "Refuses releases with unsimulated reform validation; warns when staging telemetry is missing; uploads artifacts, creates the immutable HF tag, flips latest.json, and fires the Slack release alert.",
      },
    ],
  },
];

// Cross-reference (verified against source_stages.json at the commit above):
// variables that external validation flagged as absent are exactly the ones no
// source stage declares as an output.
export const UNDECLARED_VALIDATION_INPUTS = [
  {
    variable: "qualified_tuition_expenses",
    issue: "https://github.com/PolicyEngine/populace/issues/253",
    effect: "education credits validate ~40% low",
  },
  {
    variable: "qualified_passenger_vehicle_loan_interest",
    issue: "https://github.com/PolicyEngine/populace/issues/252",
    effect: "OBBBA auto-loan deduction is structurally $0",
  },
  {
    variable: "has_valid_ssn / immigration status",
    issue: "https://github.com/PolicyEngine/populace/issues/225",
    effect: "SSN- and immigration-conditioned policy is a no-op",
  },
  {
    variable: "childcare expenses (CDCC inputs)",
    issue: null,
    effect: "CDCC validates ~31% low — under investigation",
  },
];
