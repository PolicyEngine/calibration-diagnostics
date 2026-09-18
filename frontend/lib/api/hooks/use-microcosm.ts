import { useEffect, useMemo } from "react";
import {
  keepPreviousData,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { releaseLabel } from "@/components/shared/format";
import {
  useCountry,
  type Country,
} from "@/components/layout/country-context";
import {
  LATEST_RELEASE_STALE_TIME_MS,
  PUBLISHED_RELEASE_STALE_TIME_MS,
} from "@/lib/api/cache-policy";
import { withBasePath } from "@/lib/base-path";
import type { ExplorerState } from "@/lib/microcosm/calibration-explorer";
import type { CalibrationTreeResponse } from "@/lib/microcosm/calibration-tree";
import {
  calibrationTreeResponseFromBundle,
  calibrationTreeTargetDetailSelection,
  calibrationTreeTargetsFromSummaries,
  parseCalibrationTreeComparisonTargetDetail,
  parseCalibrationTreeIndex,
  parseCalibrationTreePart,
  type CalibrationTreeArtifactPart,
  type CalibrationTreeFilterIndexArtifact,
  type CalibrationTreeIndexArtifact,
  type CalibrationTreePart,
  type CalibrationTreeComparisonTargetDetailResponse,
  type CalibrationTreeTargetDetailsArtifact,
  type CalibrationTreeTargetSummaryArtifact,
  type CalibrationTreeTierArtifact,
} from "@/lib/microcosm/calibration-tree-artifact";
import type { CalibrationProvenance } from "@/lib/microcosm/target-loss-attribution";
import type {
  TargetChangeMode,
  TargetChangeRow,
} from "@/lib/microcosm/target-change";
import type {
  TargetChangeTreeApiResponse,
  TargetChangeTreeResponse,
} from "@/lib/microcosm/target-change-tree";
import { HOSTED_US_RELEASE } from "@/lib/microcosm/production-release";
import {
  hasCapability,
  type CountryCapability,
  type RepositoryVisibility,
} from "@/lib/microcosm/countries";
import { apiGet } from "../client";

export interface MicrocosmGates {
  parity_gaps?: number | null;
  exported_nonzero?: {
    passed?: boolean | null;
    stored_columns?: number | null;
  };
  calibration?: {
    within_10pct_share?: number | null;
    loss?: number | null;
    max_weight?: number | null;
    weights_above_500k?: number | null;
    max_weight_ratio?: number | null;
  };
  smoke?: Record<string, number | null>;
  [key: string]: unknown;
}

export interface MicrocosmSkippedTarget {
  name: string;
  reason: string;
}

export interface MicrocosmTargetRow {
  name?: string | null;
  target?: number | null;
  initial_estimate?: number | null;
  final_estimate?: number | null;
  relative_error?: number | null;
  within_tolerance?: boolean | null;
  // Derived at read time.
  family?: string | null;
  state?: string | null;
  base_name?: string | null;
  geography?: string | null;
  level?: string | null;
  source?: string | null;
  source_label?: string | null;
  source_url?: string | null;
  variable?: string | null;
  variable_label?: string | null;
  target_label?: string | null;
  measure?: string | null;
  target_role?: string | null;
  source_measure_id?: string | null;
  policyengine_variables?: string[] | null;
  policyengine_map_to?: string | null;
  policyengine_filter_variable?: string | null;
  materializer?: string | null;
  measure_mode?: string | null;
  error_kind?: "relative" | "absolute" | null;
  initial_error?: number | null;
  final_error?: number | null;
  initial_miss?: number | null;
  final_miss?: number | null;
  abs_final_miss?: number | null;
  absolute_improvement?: number | null;
  abs_error?: number | null;
  breakdown?: string | null;
  dims?: string[] | null;
  target_dimensions?: {
    key: string;
    label: string;
    value: string;
    value_id?: string;
    source_key?: string;
    raw_value?: string;
    rank?: number;
  }[] | null;
  dimension_adapter?:
    | "hierarchy"
    | "structured"
    | "legacy_filter"
    | "legacy_name"
    | null;
  target_representation?: "legacy" | "structured" | "hierarchy" | null;
  variable_key?: string | null;
  // schema v2 published registry metadata (null on v1).
  source_citation?: string | null;
  entity?: string | null;
  aggregation?: string | null;
  measure_name?: string | null;
  period?: number | null;
  chronicle?: {
    fact_key?: string | null;
    source_record_id?: string | null;
    semantic_fact_key?: string | null;
    aggregate_fact_key?: string | null;
    legacy_fact_key?: string | null;
    period_type?: string | null;
    source_period?: string | null;
    target_period?: string | null;
    geography_level?: string | null;
    geography_id?: string | null;
    geography_vintage?: string | null;
    domain?: string | null;
    entity_name?: string | null;
    entity_role?: string | null;
    measure_concept?: string | null;
    source_concept?: string | null;
    concept_relation?: string | null;
    concept_authority?: string | null;
    measure_unit?: string | null;
    value_operation?: string | null;
    layout_record_set_id?: string | null;
    layout_groupby_dimension?: string | null;
    layout_groupby_value_id?: string | null;
    layout_measure_id?: string | null;
    dimension_set_key?: string | null;
    universe_constraint_set_key?: string | null;
    universe_constraint_count?: number | null;
    filters?: {
      key: string;
      label: string;
      value: string;
      raw_value?: string;
    }[];
  } | null;
  estimate_warning?: string | null;
  calibration_status?: "included" | "skipped" | "not_materialized" | null;
  calibration_status_label?: string | null;
  calibration_status_reason?: string | null;
  initial_relative_error?: number | null;
  abs_relative_error?: number | null;
  improvement?: number | null;
  direction?: "over" | "under" | "exact" | null;
  target_loss_weight?: number | null;
  target_loss_weight_share?: number | null;
  target_loss_scale?: number | null;
  final_capped_scaled_error?: number | null;
  final_loss_contribution?: number | null;
  [key: string]: unknown;
}

export interface MicrocosmVariableRow {
  variable_key: string;
  source: string;
  source_label: string;
  variable: string;
  variable_label?: string | null;
  measure: string | null;
  level: string;
  policyengine_variables?: string[];
  policyengine_map_to?: string | null;
  policyengine_filter_variable?: string | null;
  materializer?: string | null;
  measure_mode?: string | null;
  n_targets: number;
  within_10pct: number;
  within_tolerance: number;
  mean_abs_relative_error: number | null;
}

export interface MicrocosmTargetDimension {
  key: string;
  label: string;
  values: string[];
}

export interface MicrocosmFamilyFitRow {
  family: string;
  n_targets: number;
  within_tolerance: number;
  within_10pct: number;
  mean_abs_relative_error: number | null;
}

export type MicrocosmDiagnosticsStatus = "ok" | "empty" | "incompatible";
export type MicrocosmTargetLossAttributionStatus =
  | "reported"
  | "exact_reconstructed"
  | "derived"
  | "unavailable";

export interface GeographyCoverageBlock {
  n_geographies?: number | null;
  household_records_min?: number | null;
  household_records_median?: number | null;
  household_records_max?: number | null;
  n_under_50?: number | null;
  n_under_100?: number | null;
  counts?: Record<string, number>;
}

// Typed `release_manifest.country` merged over the country registration
// (server: releaseCountry in lib/microcosm/latest-artifact.ts).
export interface MicrocosmArtifactCountry {
  code: Country;
  label: string;
  geography_id: string | null;
  geography_label: string;
  repository_visibility: RepositoryVisibility;
  capabilities: CountryCapability[];
}

export interface MicrocosmArtifactPresentation {
  overview_intro?: string;
  targets_intro?: string;
}

export interface MicrocosmTargetSchema {
  diagnostics_schema_version: number | null;
  structured_dimensions: boolean;
  target_representation:
    | "legacy"
    | "structured"
    | "hierarchy"
    | "mixed"
    | "unknown";
}

export interface MicrocosmCalibration {
  available: boolean;
  country?: MicrocosmArtifactCountry;
  presentation?: MicrocosmArtifactPresentation | null;
  target_schema?: MicrocosmTargetSchema;
  description?: string | null;
  diagnostics_status?: MicrocosmDiagnosticsStatus;
  dataset_role?: string | null;
  is_default?: boolean;
  is_local_area?: boolean;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  weight_entity?: string | null;
  options?: Record<string, unknown>;
  l0_lambda?: number | null;
  n_nonzero?: number | null;
  n_records?: number | null;
  geography_coverage?: {
    unit?: string;
    states?: GeographyCoverageBlock | null;
    congressional_districts?: GeographyCoverageBlock | null;
  } | null;
  initial_loss?: number | null;
  final_loss?: number | null;
  loss_kind?: "normalized_target_loss" | "raw_optimizer_objective";
  fraction_within_10pct?: number | null;
  loss_trajectory?: number[];
  skipped?: MicrocosmSkippedTarget[];
  declared_targets?: number | null;
  compiled_candidate_targets?: number | null;
  dropped_target_count?: number;
  included_target_count?: number;
  calibration_provenance?: CalibrationProvenance;
  target_loss_attribution?: {
    status: MicrocosmTargetLossAttributionStatus;
    aggregate: number | null;
    historical_final_loss: number | null;
    cap: number | null;
    basis_identifier: string | null;
    basis_hash: string | null;
    verification: {
      valid: boolean;
      difference: number | null;
      tolerance: {
        kind: "floating_point" | "six_decimal_quantization" | "not_applicable";
        absolute: number;
        relative: number;
      };
    } | null;
    producer_warnings: Array<{
      code: string;
      severity: string | null;
      message: string;
    }>;
    reason: string | null;
    target_count: number;
  };
  total_targets?: number;
  within_tolerance_count?: number;
  family_fit?: MicrocosmFamilyFitRow[];
}

export interface MicrocosmReleaseEntry {
  release_id: string;
  date: string;
  files: string[];
  has_calibration: boolean;
  dataset_role?: string | null;
  is_default?: boolean;
  is_local_area?: boolean;
}

export interface MicrocosmReleasesResponse {
  latest_release_id: string | null;
  default_release_id?: string;
  selection_mode?: "dashboard_manifest";
  revision?: string;
  updated_at: string | null;
  releases: MicrocosmReleaseEntry[];
  all_releases: MicrocosmReleaseEntry[];
}

export interface MicrocosmCalibrationBuild {
  buildArtifactId: string;
  kind: "release" | "staging";
  sourceId: string;
  label: string;
  releaseId: string | null;
  stagingRunId: string | null;
  hfRepo: string;
  hfCommitSha: string;
  treeSchemaVersion: 6;
  indexSha256: string;
  indexBytes: number;
  createdAt: string | null;
  updatedAt: string;
}

export interface MicrocosmCalibrationBuildManifest {
  schemaVersion: 6;
  country: Country;
  latestReleaseBuildArtifactId: string | null;
  builds: MicrocosmCalibrationBuild[];
}

export interface MicrocosmResponse {
  source_repo: string;
  repo_type: string;
  revision: string;
  source: "huggingface_live" | string;
  release_id: string;
  updated_at: string | null;
  source_artifacts: { name: string; path: string; url: string }[];
  limitations: string[];
  build_manifest: {
    build_id?: string | null;
    builder?: string | null;
    build_sha?: string | null;
    build_date?: string | null;
    dataset?: { filename?: string | null; sha256?: string | null };
    calibration?: { filename?: string | null; sha256?: string | null };
    construction?: string | null;
    gates?: MicrocosmGates;
    [key: string]: unknown;
  };
  release_manifest: {
    schema_version?: number | null;
    data_package?: { name?: string | null; version?: string | null };
    default_datasets?: Record<string, string>;
    compatible_model_packages?: { name: string; specifier: string }[];
    compatible_core_packages?: { name: string; specifier: string }[];
    build?: Record<string, unknown>;
    artifacts?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  gates: MicrocosmGates;
  calibration: MicrocosmCalibration;
  highlights: {
    worst_fit: MicrocosmTargetRow[];
    biggest_improvements: MicrocosmTargetRow[];
    worst_bounded_relative_fit?: MicrocosmTargetRow[];
    extreme_relative_outliers?: MicrocosmTargetRow[];
    extreme_relative_outlier_count?: number;
    largest_absolute_misses?: MicrocosmTargetRow[];
    biggest_relative_improvements?: MicrocosmTargetRow[];
    biggest_absolute_improvements?: MicrocosmTargetRow[];
  };
}

export interface MicrocosmTargetDiagnostics {
  available: boolean;
  country?: MicrocosmArtifactCountry;
  presentation?: MicrocosmArtifactPresentation | null;
  target_schema?: MicrocosmTargetSchema;
  description?: string | null;
  path?: string | null;
  release_id?: string | null;
  schema_version?: number | null;
  metric?: string | null;
  families?: string[];
  sources?: string[];
  levels?: string[];
  geographies?: string[];
  variables?: MicrocosmVariableRow[];
  dimensions?: MicrocosmTargetDimension[];
  // Targets per named scope in the release (the `scope` query parameter).
  scope_counts?: { healthcare?: number };
  summary: {
    diagnostics_status?: MicrocosmDiagnosticsStatus;
    total_targets?: number | null;
    within_tolerance_count?: number | null;
    fraction_within_10pct?: number | null;
    included_target_count?: number | null;
    skipped_target_count?: number | null;
    dropped_target_count?: number | null;
    declared_targets?: number | null;
    compiled_candidate_targets?: number | null;
    [key: string]: unknown;
  };
  total_targets: number;
  filtered_total?: number;
  returned?: number;
  limit?: number;
  offset?: number;
  has_next?: boolean;
  display_limit?: number;
  filters?: Record<string, unknown>;
  targets: MicrocosmTargetRow[];
}

export interface MicrocosmComparisonRow {
  name: string;
  comparison_id?: string;
  match_kind?: "base_name" | "chronicle_fact_key" | "structured_identity" | null;
  current_name?: string | null;
  candidate_name?: string | null;
  current_representation?: "legacy" | "structured" | null;
  candidate_representation?: "legacy" | "structured" | null;
  target_label?: string | null;
  source?: string | null;
  variable_key?: string | null;
  variable?: string | null;
  measure?: string | null;
  level?: string | null;
  breakdown?: string | null;
  dims?: string[] | null;
  target_dimensions?: {
    key: string;
    label: string;
    value: string;
    source_key?: string;
    raw_value?: string;
    rank?: number;
  }[] | null;
  geography?: string | null;
  a_target?: number | null;
  b_target?: number | null;
  a_final_estimate?: number | null;
  b_final_estimate?: number | null;
  error_kind?: "relative" | "absolute" | null;
  a_error?: number | null;
  b_error?: number | null;
  a_relative_error?: number | null;
  b_relative_error?: number | null;
  a_within_tolerance?: boolean | null;
  b_within_tolerance?: boolean | null;
  abs_rel_delta?: number | null;
}

export interface MicrocosmComparisonVariableRow {
  variable_key: string;
  source?: string | null;
  variable?: string | null;
  measure?: string | null;
  level?: string | null;
  common_targets: number;
  relative_targets: number;
  improved: number;
  regressed: number;
  unchanged: number;
  a_mean_abs_error: number | null;
  b_mean_abs_error: number | null;
  mean_abs_delta: number | null;
}

export interface MicrocosmComparison {
  a: {
    release_id: string;
    description?: string | null;
    total_targets: number;
    initial_loss: number | null;
    final_loss: number | null;
    loss_kind: "normalized_target_loss" | "raw_optimizer_objective";
    weighted_target_error: number | null;
    fraction_within_10pct: number | null;
  };
  b: {
    release_id: string;
    description?: string | null;
    total_targets: number;
    initial_loss: number | null;
    final_loss: number | null;
    loss_kind: "normalized_target_loss" | "raw_optimizer_objective";
    weighted_target_error: number | null;
    fraction_within_10pct: number | null;
  };
  summary: {
    common: number;
    added: number;
    removed: number;
    improved: number;
    regressed: number;
    unchanged: number;
    losses_comparable: boolean;
    loss_kind: "normalized_target_loss" | "raw_optimizer_objective" | "mixed";
    matching: {
      current_representation: "legacy" | "structured" | "mixed" | "unknown";
      candidate_representation: "legacy" | "structured" | "mixed" | "unknown";
      matched_by: {
        base_name: number;
        chronicle_fact_key: number;
        structured_identity: number;
      };
      ambiguous_key_groups: {
        base_name: number;
        chronicle_fact_key: number;
        structured_identity: number;
      };
    };
  };
  variables: MicrocosmComparisonVariableRow[];
  rows: MicrocosmComparisonRow[];
}

export interface MicrocosmStagingRunSummary {
  run_id: string;
  candidate_release_id?: string | null;
  release_id?: string | null;
  country_code?: string | null;
  run_kind?: string | null;
  non_release?: boolean | null;
  schema_version?: number | null;
  status?: string | null;
  stage?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
  progress_path?: string | null;
  run_manifest_path?: string | null;
}

export interface MicrocosmStagingRunsResponse {
  available: boolean;
  source_repo: string | null;
  revision: string | null;
  detail?: string | null;
  runs: MicrocosmStagingRunSummary[];
  incompatible_runs: {
    run_id: string;
    run_manifest_path: string;
    detail: string;
  }[];
}

export interface MicrocosmStagingRunResponse {
  available: boolean;
  source_repo: string | null;
  revision: string | null;
  detail?: string | null;
  run_id: string;
  candidate_release_id?: string | null;
  release_id?: string | null;
  country_code?: string | null;
  run_kind?: string | null;
  non_release?: boolean | null;
  schema_version?: number | null;
  delivery?: Record<string, unknown> | null;
  progress?: Record<string, unknown> | null;
  run_manifest?: Record<string, unknown> | null;
  calibration_progress?: {
    events?: {
      epoch?: number | null;
      epochs?: number | null;
      loss?: number | null;
      time?: string | null;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  } | null;
  events?: Record<string, unknown>[];
  has_calibration: boolean;
  calibration?: MicrocosmCalibration | null;
  reform_validation?: ReformValidationResponse | null;
  build_manifest?: Record<string, unknown> | null;
  release_manifest?: Record<string, unknown> | null;
}

export interface MicrocosmVariableValue {
  variable: string;
  period: string;
  release_id: string;
  dataset: string;
  entity: string;
  definition_period: string;
  label?: string | null;
  documentation?: string | null;
  value: number | null;
  weighted_sum: number | null;
  raw_sum: number | null;
  weight_sum: number | null;
  record_count: number;
  nonzero_weight_count: number | null;
  state_filter?: string | null;
  elapsed_seconds: number | null;
}

export interface MicrocosmVariableLookupResponse extends Partial<MicrocosmVariableValue> {
  period: string;
  release_id: string;
  dataset: string;
  dataset_path?: string | null;
  variables: MicrocosmVariableValue[];
  elapsed_seconds: number | null;
  runtime?: {
    packages: Record<string, string | null>;
    source_commit: string | null;
  };
  data_identity?: {
    repo: string;
    hf_revision: string;
    release_id: string;
    filename: string;
    sha256: string;
    verified: boolean;
  };
}

export interface CatalogVariable {
  name: string;
  label: string | null;
  entity: string | null;
  unit: string | null;
}

export function useVariableCatalog() {
  return useQuery({
    queryKey: ["variable-catalog"],
    queryFn: async (): Promise<CatalogVariable[]> => {
      const res = await fetch(withBasePath("/variable-catalog.json"));
      if (!res.ok) throw new Error("Could not load the variable catalog.");
      const data = (await res.json()) as { variables?: CatalogVariable[] };
      return data.variables ?? [];
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useMicrocosmVariableValue(params: {
  variables?: string[];
  period?: string;
  release?: string;
}) {
  const variables = params.variables?.map((v) => v.trim()).filter(Boolean) ?? [];
  const path = "/microcosm/variable";
  const endpointCacheKey = "reviewed-modal-runtime-v1";
  return useQuery({
    queryKey: [
      "microcosm",
      "variable",
      endpointCacheKey,
      variables,
      params.period ?? "2024",
      params.release || HOSTED_US_RELEASE.release_id,
    ],
    queryFn: () =>
      apiGet<MicrocosmVariableLookupResponse>(path, {
        variables,
        period: params.period ?? "2024",
        release: params.release || HOSTED_US_RELEASE.release_id,
      }),
    enabled: variables.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

export interface ReformValidationRow {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  in_sample?: boolean;
  period?: number | null;
  // "percent" for rate backtests (fractions in the score fields); absent or
  // "currency-USD" for budget-effect rows.
  unit?: "currency-USD" | "percent" | null;
  jct_score?: number | null;
  jct_score_fy2026?: number | null;
  jct_score_type?: string | null;
  jct_window?: string | null;
  jct_benchmark_window?: string | null;
  jct_source?: string | null;
  jct_source_url?: string | null;
  jct_published?: string | null;
  microcosm_estimate?: number | null;
  microcosm_window?: string | null;
  microcosm_annual?: Record<string, number> | null;
  abs_error?: number | null;
  relative_error?: number | null;
  abs_relative_error?: number | null;
  within_10pct?: boolean | null;
  direction?: "over" | "under" | "exact" | null;
}

export interface ReformValidationResponse {
  available: boolean;
  release_id: string;
  // present when available === false
  reason?: string;
  expected_path?: string;
  // present when available === true
  updated_at?: string | null;
  schema_version?: number | null;
  baseline_period?: number | null;
  scoring_window?: string | null;
  rows?: ReformValidationRow[];
  summary?: {
    n_reforms: number;
    n_scored: number;
    within_10pct: number;
    mean_abs_relative_error: number | null;
    median_abs_relative_error: number | null;
    n_out_of_sample: number;
    n_out_of_sample_scored: number;
    out_of_sample_within_10pct: number;
    out_of_sample_mean_abs_relative_error: number | null;
  };
  source_artifact?: { name: string; path: string; url: string };
}

export function useMicrocosmStagingRuns() {
  const { country } = useCountry();
  const staging = hasCapability(country, "staging");
  return useQuery({
    queryKey: ["microcosm", "staging", "runs", country],
    queryFn: () =>
      apiGet<MicrocosmStagingRunsResponse>("/microcosm/staging/runs", { country }),
    enabled: staging,
    staleTime: 15 * 1000,
    refetchInterval: staging ? 30 * 1000 : false,
  });
}

export function useMicrocosmStagingRun(runId?: string) {
  const { country } = useCountry();
  const staging = hasCapability(country, "staging");
  return useQuery({
    queryKey: ["microcosm", "staging", "run", country, runId],
    queryFn: () =>
      apiGet<MicrocosmStagingRunResponse>("/microcosm/staging/run", {
        id: runId,
        country,
      }),
    enabled: staging && Boolean(runId),
    staleTime: 10 * 1000,
    refetchInterval: staging ? 30 * 1000 : false,
  });
}

export function useMicrocosmStagingCompare(runId?: string, release = "latest") {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "staging", "compare", country, runId, release],
    queryFn: () =>
      apiGet<MicrocosmComparison & { available?: boolean; detail?: string }>(
        "/microcosm/staging/compare",
        { run: runId, release, country },
      ),
    enabled: hasCapability(country, "staging") && Boolean(runId),
    staleTime: 30 * 1000,
  });
}

function explorerApiParams(
  state: ExplorerState,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {
    breakdown: state.breakdown,
    geography_level: state.filters.geographyLevels,
    geography: state.filters.geographies,
    fit_band: state.filters.fitBands,
    comparison_fit: state.filters.comparisonFits,
    status: state.filters.calibrationStatuses,
  };
  if (state.path.source && state.path.program) {
    result.source = state.path.source;
    result.program = state.path.program;
    for (const dimension of state.path.dimensions) {
      result[`dim.${dimension.key}`] = dimension.value;
    }
    if (state.path.target) result.target = state.path.target;
  }
  if (state.path.geography) result.path_geography = state.path.geography;
  return result;
}

export function useMicrocosmStagingTargetChangeTree({
  runId,
  releaseId,
  mode,
  state,
  enabled = true,
}: {
  runId?: string;
  releaseId?: string;
  mode: TargetChangeMode;
  state: ExplorerState;
  enabled?: boolean;
}) {
  const { country } = useCountry();
  return useQuery({
    queryKey: [
      "microcosm",
      "staging",
      "target-change-tree",
      country,
      runId,
      releaseId,
      mode,
      state,
    ],
    queryFn: () =>
      apiGet<TargetChangeTreeApiResponse>(
        "/microcosm/staging/target-change-tree",
        {
          ...explorerApiParams(state),
          run: runId,
          release: releaseId,
          mode,
          country,
        },
      ),
    enabled:
      enabled &&
      hasCapability(country, "staging") &&
      Boolean(runId && releaseId && releaseId !== "latest"),
    staleTime: 30 * 1000,
  });
}

export function useMicrocosmReleases() {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "releases", country],
    queryFn: () => apiGet<MicrocosmReleasesResponse>("/microcosm/releases", { country }),
    staleTime: LATEST_RELEASE_STALE_TIME_MS,
  });
}

export function useMicrocosmCalibrationBuildManifest() {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "calibration-build-manifest", country],
    queryFn: () => apiGet<MicrocosmCalibrationBuildManifest>(
      "/microcosm/tree-manifest",
      { country },
    ),
    staleTime: LATEST_RELEASE_STALE_TIME_MS,
  });
}

// Non-default, experimental artifacts (microcosm#398) are flagged in the picker
// so a reviewer never mistakes a local-area build for the certified national
// release.
export function releaseRoleSuffix(entry: MicrocosmReleaseEntry): string {
  if (entry.is_local_area) return " · local area · experimental";
  if (entry.is_default === false) return " · non-default";
  return "";
}

// The empty selection follows the dashboard manifest; explicit ids remain
// historical release selections.
export function releaseSelectOptions(
  data?: MicrocosmReleasesResponse,
): { value: string; label: string }[] {
  const releases = data?.releases ?? [];
  const defaultId = data?.default_release_id ?? data?.latest_release_id;
  const selectedDefault = releases.find((r) => r.release_id === defaultId);
  const defaultLabel = data ? "Latest" : "Default release";
  return [
    {
      value: "",
      label: selectedDefault
        ? `${defaultLabel} · ${releaseLabel(selectedDefault.release_id, selectedDefault.date)}`
        : defaultLabel,
    },
    ...releases.map((r) => ({
      value: r.release_id,
      label: `${releaseLabel(r.release_id, r.date)}${releaseRoleSuffix(r)}`,
    })),
  ];
}

export function useMicrocosm(release?: string) {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", country, release ?? "latest"],
    queryFn: () =>
      apiGet<MicrocosmResponse>("/microcosm", { release: release || undefined, country }),
    staleTime: release
      ? PUBLISHED_RELEASE_STALE_TIME_MS
      : LATEST_RELEASE_STALE_TIME_MS,
  });
}

export interface MicrocosmTreemapLeaf {
  key: string;
  source: string;
  variable: string;
  label: string | null;
  measure: string | null;
  measure_counts: { measure: string | null; n_targets: number }[];
  filters?: {
    program?: string;
    geography?: string;
  };
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
}

export interface MicrocosmTreemapGroup {
  source: string;
  label: string;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
  children: MicrocosmTreemapLeaf[];
}

export interface MicrocosmTreemapResponse {
  release_id: string;
  loss_attribution_available: boolean;
  total_targets: number;
  total_within_10pct: number;
  total_scored: number;
  total_loss: number;
  groups: MicrocosmTreemapGroup[];
}

export function useMicrocosmTargetTreemap(release?: string, breakdown?: "program" | "geography") {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "target-treemap", country, release ?? "latest", breakdown ?? "program"],
    queryFn: () =>
      apiGet<MicrocosmTreemapResponse>("/microcosm/target-treemap", {
        release: release || undefined,
        breakdown: breakdown || undefined,
        country,
      }),
    staleTime: release
      ? PUBLISHED_RELEASE_STALE_TIME_MS
      : LATEST_RELEASE_STALE_TIME_MS,
  });
}

export function useMicrocosmCalibrationTree(
  state: ExplorerState,
  source: MicrocosmCalibrationTreeSource,
) {
  const { country } = useCountry();
  const releaseQuery = usePublishedCalibrationTree(
    state,
    source.kind === "release" ? source.release : undefined,
    country,
    source.kind === "release",
  );
  const stagingQuery = useQuery({
    ...microcosmStagingCalibrationTreeQueryOptions(
      state,
      source.kind === "staging" ? source.runId : "",
      country,
    ),
    enabled: source.kind === "staging",
    placeholderData: keepPreviousData,
  });
  return source.kind === "staging"
    ? {
        ...stagingQuery,
        filtersReady: true,
        targetDetailIsLoading: false,
        targetDetailError: null,
        retryTargetDetail: () => {},
      }
    : releaseQuery;
}

export type MicrocosmCalibrationTreeSource =
  | { kind: "release"; release?: string }
  | { kind: "staging"; runId: string };

export async function fetchCalibrationTreePartsConcurrently<T>(
  parts: readonly T[],
  fetchPart: (part: T) => Promise<unknown>,
): Promise<void> {
  await Promise.all(parts.map((part) => fetchPart(part)));
}

export function microcosmCalibrationTreeIndexQueryOptions(
  release: string | undefined,
  country: Country,
) {
  return {
    queryKey: [
      "microcosm",
      "calibration-tree-part",
      country,
      release ?? "latest",
      "index",
    ],
    queryFn: async (): Promise<CalibrationTreeIndexArtifact> => {
      const index = parseCalibrationTreeIndex(await apiGet<unknown>("/microcosm/tree", {
        release: release || undefined,
        country,
        part: "index",
      }));
      if (index.country !== country) {
        throw new Error("Calibration tree index country does not match the request.");
      }
      return index;
    },
    staleTime: release
      ? PUBLISHED_RELEASE_STALE_TIME_MS
      : LATEST_RELEASE_STALE_TIME_MS,
  };
}

function calibrationTreePartQueryOptions(
  country: Country,
  buildArtifactId: string,
  part: Exclude<CalibrationTreePart, "index">,
  request: {
    endpoint?: string;
    queryKeyPrefix?: string;
    params?: Record<string, string>;
  } = {},
) {
  const endpoint = request.endpoint ?? "/microcosm/tree";
  const queryKeyPrefix = request.queryKeyPrefix ?? "calibration-tree-part";
  return {
    queryKey: [
      "microcosm",
      queryKeyPrefix,
      country,
      buildArtifactId,
      part,
    ],
    queryFn: async (): Promise<CalibrationTreeArtifactPart> => {
      const artifact = parseCalibrationTreePart(await apiGet<unknown>(endpoint, {
        ...request.params,
        country,
        build: buildArtifactId,
        part,
      }), part);
      if (
        artifact.country !== country ||
        artifact.buildArtifactId !== buildArtifactId
      ) {
        throw new Error(`Calibration tree part ${part} does not match the request.`);
      }
      return artifact;
    },
    staleTime: PUBLISHED_RELEASE_STALE_TIME_MS,
  };
}

export function microcosmComparisonTargetDetailQueryOptions(
  country: Country,
  buildArtifactId: string,
  targetOrdinal: number,
) {
  return {
    queryKey: [
      "microcosm",
      "calibration-comparison-target-detail",
      country,
      buildArtifactId,
      targetOrdinal,
    ],
    queryFn: async (): Promise<CalibrationTreeComparisonTargetDetailResponse> => {
      const detail = parseCalibrationTreeComparisonTargetDetail(
        await apiGet<unknown>("/microcosm/comparison-tree/target-detail", {
          country,
          build: buildArtifactId,
          target: targetOrdinal,
        }),
      );
      if (
        detail.country !== country ||
        detail.buildArtifactId !== buildArtifactId ||
        detail.targetOrdinal !== targetOrdinal
      ) {
        throw new Error("Calibration comparison target detail does not match the request.");
      }
      return detail;
    },
    staleTime: PUBLISHED_RELEASE_STALE_TIME_MS,
  };
}

const DEFAULT_CALIBRATION_TREE_PART_REQUEST = {};

function useCalibrationTreeBundle(
  state: ExplorerState,
  country: Country,
  enabled: boolean,
  indexQueryOptions: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<CalibrationTreeIndexArtifact>;
    staleTime: number;
  },
  partRequest: {
    endpoint?: string;
    queryKeyPrefix?: string;
    params?: Record<string, string>;
  } = DEFAULT_CALIBRATION_TREE_PART_REQUEST,
) {
  const queryClient = useQueryClient();
  const indexQuery = useQuery({
    ...indexQueryOptions,
    enabled,
  });
  const index = indexQuery.data;
  const buildArtifactId = index?.buildArtifactId ?? "";
  const eagerDescriptors = useMemo(
    () => index
      ? [
          index.parts.filterIndex,
          ...index.parts.targetSummaries,
          ...index.parts.tiers,
        ]
      : [],
    [index],
  );
  const eagerQueries = useQueries({
    queries: eagerDescriptors.map((descriptor) => ({
      ...calibrationTreePartQueryOptions(
        country,
        buildArtifactId,
        descriptor.part,
        partRequest,
      ),
      enabled: false,
    })),
  });
  const loadedParts = new Map(
    eagerQueries.flatMap((query) =>
      query.data ? [[query.data.part, query.data] as const] : [],
    ),
  );
  const loadedTiers = (index?.parts.tiers ?? []).flatMap((descriptor) => {
    const artifact = loadedParts.get(descriptor.part);
    return artifact?.part.startsWith("tier-")
      ? [artifact as CalibrationTreeTierArtifact]
      : [];
  });
  const loadedFilterIndex = loadedParts.get("filter-index");
  const filterIndex = loadedFilterIndex?.part === "filter-index"
    ? loadedFilterIndex as CalibrationTreeFilterIndexArtifact
    : undefined;
  const targetSummaries = (index?.parts.targetSummaries ?? []).flatMap(
    (descriptor) => {
      const artifact = loadedParts.get(descriptor.part);
      return artifact?.part.startsWith("target-summary-")
        ? [artifact as CalibrationTreeTargetSummaryArtifact]
        : [];
    },
  );
  const summariesComplete = Boolean(index) &&
    targetSummaries.length === index!.parts.targetSummaries.length;
  const targetSummaryVersion = index?.parts.targetSummaries.map((descriptor) => {
    const queryIndex = eagerDescriptors.findIndex(
      (candidate) => candidate.part === descriptor.part,
    );
    return eagerQueries[queryIndex]?.dataUpdatedAt ?? 0;
  }).join(":") ?? "";
  const targetSummaryResult = useMemo(() => {
    if (!index || !summariesComplete) {
      return { targets: undefined, error: null };
    }
    try {
      return {
        targets: calibrationTreeTargetsFromSummaries(index, targetSummaries),
        error: null,
      };
    } catch (error) {
      return {
        targets: undefined,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  // React Query preserves each artifact reference until its cached data changes.
  // The update-time signature avoids rebuilding a potentially large target array
  // on unrelated explorer-state renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, summariesComplete, targetSummaryVersion]);

  useEffect(() => {
    if (!enabled || !index) return;
    void fetchCalibrationTreePartsConcurrently(
      eagerDescriptors,
      (descriptor) => queryClient.fetchQuery(
        calibrationTreePartQueryOptions(
          country,
          index.buildArtifactId,
          descriptor.part,
          partRequest,
        ),
      ),
    ).catch(() => {
      // Each React Query observer retains its own error. Starting every request
      // first ensures that one failed part does not prevent the browser from
      // completing other requests that are already in flight.
    });
  }, [country, eagerDescriptors, enabled, index, partRequest, queryClient]);

  const targetsById = useMemo(
    () => new Map(
      (targetSummaryResult.targets ?? []).map((target, targetOrdinal) => [
        target.id,
        { target, targetOrdinal },
      ]),
    ),
    [targetSummaryResult.targets],
  );
  const selectedTarget = state.path.target
    ? targetsById.get(state.path.target)
    : undefined;
  let detailDescriptor:
    | CalibrationTreeIndexArtifact["parts"]["targetDetails"][number]
    | undefined;
  let detailLocationError: Error | null = null;
  if (state.path.target && summariesComplete && !selectedTarget) {
    detailLocationError = new Error(
      `Calibration target ${state.path.target} is missing from the target-summary shards.`,
    );
  } else if (
    selectedTarget &&
    index?.parts.targetDetailStrategy === "shards"
  ) {
    try {
      detailDescriptor = calibrationTreeTargetDetailSelection(
        index,
        selectedTarget.targetOrdinal,
      ).descriptor;
    } catch (error) {
      detailDescriptor = undefined;
      detailLocationError = error instanceof Error ? error : new Error(String(error));
    }
  }
  const targetDetailQueryDefinitions: Array<
    ReturnType<typeof calibrationTreePartQueryOptions>
  > = detailDescriptor && enabled
    ? [
        calibrationTreePartQueryOptions(
          country,
          buildArtifactId,
          detailDescriptor.part,
          partRequest,
        ),
      ]
    : [];
  const targetDetailQueries = useQueries({ queries: targetDetailQueryDefinitions });
  const targetDetailQuery = targetDetailQueries[0];
  const fetchedTargetDetailShard = targetDetailQuery?.data?.part.startsWith("target-details-")
    ? targetDetailQuery.data as CalibrationTreeTargetDetailsArtifact
    : undefined;
  const targetDetailRangeError = fetchedTargetDetailShard && detailDescriptor && (
    fetchedTargetDetailShard.part !== detailDescriptor.part ||
    fetchedTargetDetailShard.startTargetOrdinal !== detailDescriptor.startTargetOrdinal ||
    fetchedTargetDetailShard.endTargetOrdinalExclusive !==
      detailDescriptor.endTargetOrdinalExclusive
  )
    ? new Error(`Calibration tree part ${detailDescriptor.part} has an unexpected target range.`)
    : null;
  const targetDetailShard = targetDetailRangeError
    ? undefined
    : fetchedTargetDetailShard;
  const comparisonTargetOrdinal =
    index?.parts.targetDetailStrategy === "source-targets" && selectedTarget
      ? selectedTarget.targetOrdinal
      : -1;
  const comparisonTargetDetailQuery = useQuery({
    ...microcosmComparisonTargetDetailQueryOptions(
      country,
      buildArtifactId,
      comparisonTargetOrdinal,
    ),
    enabled: enabled && comparisonTargetOrdinal >= 0,
  });
  const comparisonTargetDetail = comparisonTargetDetailQuery.data;
  const comparisonTargetDetailError =
    comparisonTargetDetail && selectedTarget &&
    comparisonTargetDetail.targetId !== selectedTarget.target.id
      ? new Error("Calibration comparison target detail does not match its summary.")
      : null;
  const data = index
    ? calibrationTreeResponseFromBundle(
        {
          index,
          tiers: loadedTiers,
          filterIndex,
          targetSummaries: targetSummaryResult.targets,
          targetDetailShard,
          selectedTargetDetail: comparisonTargetDetail && !comparisonTargetDetailError
            ? {
                targetOrdinal: comparisonTargetDetail.targetOrdinal,
                target: comparisonTargetDetail.target,
              }
            : undefined,
        },
        state,
      ) ?? undefined
    : undefined;
  const criticalPartError = eagerQueries.find((query, queryIndex) => {
    const part = eagerDescriptors[queryIndex]?.part;
    return query.error &&
      (part === "filter-index" || part?.startsWith("target-summary-"));
  })?.error;
  const tierError = eagerQueries.find((query, queryIndex) =>
    query.error && eagerDescriptors[queryIndex]?.part.startsWith("tier-"),
  )?.error;
  const error = indexQuery.error ||
    targetSummaryResult.error ||
    criticalPartError ||
    (!data && tierError) ||
    null;
  const targetDetailError =
    detailLocationError ||
    targetDetailRangeError ||
    comparisonTargetDetailError ||
    targetDetailQuery?.error ||
    comparisonTargetDetailQuery.error ||
    null;

  return {
    index,
    data,
    error,
    isLoading: indexQuery.isLoading || (Boolean(index) && !data && !error),
    isFetching:
      indexQuery.isFetching ||
      eagerQueries.some((query) => query.isFetching),
    isPlaceholderData: false,
    filtersReady: Boolean(filterIndex && summariesComplete),
    targetDetailIsLoading:
      Boolean(state.path.target) &&
      !targetDetailError &&
      (
        !summariesComplete ||
        Boolean(detailDescriptor && !targetDetailShard) ||
        Boolean(comparisonTargetOrdinal >= 0 && !comparisonTargetDetail)
      ),
    targetDetailError,
    retryTargetDetail: () => {
      void targetDetailQuery?.refetch();
      if (comparisonTargetOrdinal >= 0) {
        void comparisonTargetDetailQuery.refetch();
      }
    },
  };
}

function usePublishedCalibrationTree(
  state: ExplorerState,
  release: string | undefined,
  country: Country,
  enabled: boolean,
) {
  const indexQueryOptions = useMemo(
    () => microcosmCalibrationTreeIndexQueryOptions(release, country),
    [country, release],
  );
  return useCalibrationTreeBundle(
    state,
    country,
    enabled,
    indexQueryOptions,
  );
}

export function microcosmComparisonTreeIndexQueryOptions(
  currentBuildArtifactId: string,
  candidateBuildArtifactId: string,
  mode: TargetChangeMode,
  country: Country,
) {
  return {
    queryKey: [
      "microcosm",
      "calibration-comparison-tree",
      country,
      currentBuildArtifactId,
      candidateBuildArtifactId,
      mode,
      "index",
    ],
    queryFn: async (): Promise<CalibrationTreeIndexArtifact> => {
      const index = parseCalibrationTreeIndex(
        await apiGet<unknown>("/microcosm/comparison-tree", {
          country,
          a: currentBuildArtifactId,
          b: candidateBuildArtifactId,
          mode,
          part: "index",
        }),
      );
      if (
        index.country !== country ||
        index.build.kind !== "comparison" ||
        index.comparison?.currentBuildArtifactId !== currentBuildArtifactId ||
        index.comparison.candidateBuildArtifactId !== candidateBuildArtifactId ||
        index.comparison.mode !== mode
      ) {
        throw new Error("Calibration comparison index does not match the request.");
      }
      return index;
    },
    staleTime: PUBLISHED_RELEASE_STALE_TIME_MS,
  };
}

export function useMicrocosmBuildComparisonTree({
  currentBuildArtifactId,
  candidateBuildArtifactId,
  mode,
  state,
  enabled = true,
}: {
  currentBuildArtifactId?: string;
  candidateBuildArtifactId?: string;
  mode: TargetChangeMode;
  state: ExplorerState;
  enabled?: boolean;
}) {
  const { country } = useCountry();
  const current = currentBuildArtifactId ?? "";
  const candidate = candidateBuildArtifactId ?? "";
  const indexQueryOptions = useMemo(
    () => microcosmComparisonTreeIndexQueryOptions(
      current,
      candidate,
      mode,
      country,
    ),
    [candidate, country, current, mode],
  );
  const partRequest = useMemo(() => ({
    endpoint: "/microcosm/comparison-tree",
    queryKeyPrefix: "calibration-comparison-tree-part",
    params: { mode },
  }), [mode]);
  const bundle = useCalibrationTreeBundle(
    state,
    country,
    enabled && Boolean(current && candidate),
    indexQueryOptions,
    partRequest,
  );
  const comparison = bundle.index?.comparison;
  const selectedTarget = bundle.data?.groups
    .flatMap((group) => group.nodes)
    .find((node) => node.kind === "target" && node.id === state.path.target)
    ?.target as TargetChangeRow | undefined;
  const data: TargetChangeTreeResponse | undefined =
    bundle.data && comparison
      ? {
          ...bundle.data,
          available: comparison.available,
          reason: comparison.reason,
          mode: comparison.mode,
          current: comparison.current,
          candidate: comparison.candidate,
          methodology: comparison.methodology,
          matching: comparison.matching,
          summary: comparison.summary,
          selectedTarget: selectedTarget ?? null,
        }
      : undefined;
  return { ...bundle, data };
}

export function microcosmStagingCalibrationTreeQueryOptions(
  state: ExplorerState,
  runId: string,
  country: Country,
) {
  return {
    queryKey: ["microcosm", "staging", "target-tree", country, runId, state],
    queryFn: () =>
      apiGet<CalibrationTreeResponse>("/microcosm/staging/target-tree", {
        ...explorerApiParams(state),
        run: runId,
        country,
      }),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  };
}

export function useMicrocosmTargetDiagnostics(params: {
  release?: string;
  scope?: "healthcare";
  limit?: number;
  offset?: number;
  family?: string;
  variable?: string;
  measure?: string;
  program?: string;
  source?: string;
  level?: string;
  geography?: string;
  state?: string;
  direction?: string;
  within_tolerance?: string;
  search?: string;
  facet?: string[];
  sort_by?: string;
  sort_dir?: string;
}) {
  const { country } = useCountry();
  return useQuery({
    queryKey: ["microcosm", "target-diagnostics", country, params],
    queryFn: () =>
      apiGet<MicrocosmTargetDiagnostics>("/microcosm/target-diagnostics", { ...params, country }),
    placeholderData: keepPreviousData,
    staleTime: 15 * 60 * 1000,
  });
}
