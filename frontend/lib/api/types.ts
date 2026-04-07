export interface GeoOption {
  fips?: number;
  cd_geoid?: number;
  name: string;
  abbrev?: string;
}

export interface Target {
  target_idx: number;
  target_id: number | null;
  variable: string;
  geo_level: string | null;
  geographic_id: string | null;
  geo_display_name: string | null;
  domain: string | null;
  additional_constraints: string | null;
  target_value: number;
  estimate: number;
  rel_error: number;
  abs_rel_error: number;
  loss_contribution: number;
  n_contributors: number;
  included: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface ErrorDecomposition {
  target_name: string;
  target_value: number;
  raw_sum: number;
  initial_estimate: number;
  final_estimate: number;
  diagnosis: string;
  concentration: { top_1pct_share: number; top_5pct_share: number };
}

export interface Constraint {
  variable: string;
  operation: string;
  value: string;
}

export interface Provenance {
  target_id: number | null;
  variable: string;
  value: number | null;
  period: number | null;
  source: string | null;
  tolerance: number | null;
  notes: string | null;
  active: boolean | null;
  stratum_id: number | null;
  constraints: Constraint[];
  geo_level: string | null;
  geographic_id: string | null;
  uprating_factor: number | null;
  uprated_value: number | null;
}

export interface ConstraintCheck {
  variable: string;
  operation: string;
  value: string;
  contributors_satisfying: number;
  contributors_violating: number;
  pct_violating: number;
  status: "OK" | "MINOR_VIOLATION" | "VIOLATION" | "SKIPPED_UNKNOWN_VARIABLE";
}

export interface ConstraintDiffResult {
  target_name: string;
  stratum_id: number;
  constraints: ConstraintCheck[];
}

export interface EligibilityAudit {
  target_name: string;
  total_contributors: number;
  meet_criterion: number;
  fail_criterion: number;
  pct_failing: number;
  weighted_contribution_from_failing: number;
  pct_estimate_from_failing: number;
  diagnosis: string;
}

export interface Contributor {
  household_idx: number;
  raw_value: number;
  weighted_value: number;
  income: number | null;
  g_weight: number | null;
  in_poverty: boolean | null;
  state: number | null;
}

export interface ConvergencePoint {
  epoch: number;
  estimate: number;
  target: number;
  rel_error: number;
  loss: number;
}

export interface Household {
  household_idx: number;
  income: number;
  spm_threshold: number;
  in_poverty: boolean;
  initial_weight: number;
  final_weight: number;
  g_weight: number;
  state: number;
  income_decile: number;
  filter_variable_value: number | null;
}

export interface HouseholdProfile {
  household_idx: number;
  initial_weight: number;
  final_weight: number;
  g_weight: number;
  in_poverty: boolean;
  state: number;
  cd_geoid: number;
  variables: Record<string, number>;
}

export interface Attribution {
  target_idx: number;
  target_name: string;
  variable: string | null;
  geo_level: string | null;
  raw_value: number;
  weighted_value: number;
  target_rel_error: number;
}

export interface WeightSlice {
  label: string;
  n: number;
  kish_effective_n: number;
  mean: number;
  median: number;
}

export interface WeightDistribution {
  kish_effective_n: number;
  cv: number;
  design_effect: number;
  mean: number;
  median: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  max: number;
  top_1pct_weight_share: number;
  top_5pct_weight_share: number;
  slices: WeightSlice[];
}

export interface HistogramBin {
  bin_min: number;
  bin_max: number;
  count: number;
}

export interface PovertyRate {
  spm_poverty_rate: number;
  spm_poverty_rate_initial_weights: number;
  n_poor_weighted: number;
  n_total_weighted_households: number;
  n_total_weighted_individuals: number;
  benchmark_census: number;
}

export interface IncomeQuantiles {
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface IncomeDistribution {
  initial_weights: IncomeQuantiles;
  final_weights: IncomeQuantiles;
}

export interface DecomposeComponent {
  variable: string;
  initial_total: number;
  final_total: number;
  shift_pct: number;
}

export interface DecomposeResult {
  components: DecomposeComponent[];
  composite_initial: number | null;
  composite_final: number | null;
}

export interface EpochSummaryRow {
  group: string;
  epoch: number;
  mean_abs_rel_error: number;
}

export interface TargetEpochTrace {
  target_name: string;
  epochs: ConvergencePoint[];
}

export interface StratumDetail {
  stratum_id: number;
  parent_stratum_id: number | null;
  notes: string | null;
  constraints: Constraint[];
  children: { stratum_id: number; notes: string | null }[];
  targets: {
    target_id: number;
    variable: string;
    value: number;
    period: number;
    active: boolean;
  }[];
}
