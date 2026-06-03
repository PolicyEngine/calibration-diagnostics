import { NextResponse } from "next/server";

const GITHUB_RAW = "https://raw.githubusercontent.com/PolicyEngine/microplex-us/main";

const PARITY_PATH =
  "artifacts/live_pe_native_cps_puf_rich_broad_fixed_20260329/20260329T175330Z-057066af/pe_us_data_rebuild_parity.json";
const REGRESSION_SUMMARY_PATH =
  "artifacts/live_pe_us_data_rebuild_checkpoint_modelpass_regression_summary_20260410.json";
const IRS_DRILLDOWN_PATH =
  "artifacts/live_pe_us_data_rebuild_checkpoint_national_irs_other_drilldown_20260410.json";
const RUN_LEVEL_TARGET_DIAGNOSTICS_PATH = "pe_native_target_diagnostics.json";
const RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY =
  "policyengine_native_target_diagnostics";
const LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH =
  "artifacts/pe_native_target_diagnostics_current.json";

const ARTIFACTS = {
  parity: PARITY_PATH,
  regression_summary: REGRESSION_SUMMARY_PATH,
  irs_drilldown: IRS_DRILLDOWN_PATH,
};

const GENERATED_ARTIFACT_CONTRACT = [
  {
    name: "full_target_diagnostics",
    path_hint: RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
    manifest_key: RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY,
    legacy_static_dashboard_path: LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH,
    producer: "build_us_pe_native_target_diagnostics_payload",
    public_committed: false,
    description:
      "Full per-target PE-native rows saved inside each newer Microplex run bundle. The rows show Microplex aggregate estimates against target values, with us-data comparator fields when present.",
  },
  {
    name: "dashboard_payload",
    path_hint: "artifacts/microplex_dashboard_current.json",
    producer: "microplex-us-dashboard",
    public_committed: false,
    description:
      "Living dashboard payload with score runs, logs, and target diagnostics.",
  },
  {
    name: "native_scores",
    path_hint: "policyengine_native_scores.json",
    producer: "compute_us_pe_native_scores",
    public_committed: false,
    description: "Compact broad native-loss summary for one artifact bundle.",
  },
  {
    name: "native_audit",
    path_hint: "pe_us_data_rebuild_native_audit.json",
    producer: "build_policyengine_us_data_rebuild_native_audit",
    public_committed: false,
    description: "Top family and target regressions plus support audit evidence.",
  },
  {
    name: "run_index",
    path_hint: "run_index.duckdb",
    producer: "append_us_microplex_run_index_entry",
    public_committed: false,
    description: "DuckDB index for querying target deltas across saved runs.",
  },
];

const TARGET_DIAGNOSTIC_ROW_FIELDS = [
  "target_id",
  "family",
  "in_loss",
  "supported_by_microplex",
  "baseline_dataset",
  "candidate_dataset",
  "baseline_label",
  "candidate_label",
  "target_value",
  "us_data_aggregate",
  "microplex_aggregate",
  "us_data_absolute_error",
  "microplex_absolute_error",
  "us_data_relative_error",
  "microplex_relative_error",
  "delta_absolute_error",
  "delta_relative_error",
  "loss_contribution",
];

type JsonObject = Record<string, unknown>;

export const revalidate = 300;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [key, scrub(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function discoverConfiguredRunBundles() {
  return {
    artifact_root_env: "MICROPLEX_ARTIFACT_ROOTS",
    single_artifact_root_env: "MICROPLEX_ARTIFACT_ROOT",
    configured_artifact_roots: [],
    missing_artifact_roots: [],
    detected_run_bundle_count: 0,
    detected_target_diagnostics_count: 0,
    latest_run_bundle: null,
    sampled_run_bundles: [],
  };
}

async function fetchJson(path: string): Promise<JsonObject> {
  const response = await fetch(`${GITHUB_RAW}/${path}`, {
    next: { revalidate },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  return asObject(await response.json());
}

export async function GET() {
  try {
    const [parity, regression, drilldown] = await Promise.all([
      fetchJson(PARITY_PATH),
      fetchJson(REGRESSION_SUMMARY_PATH),
      fetchJson(IRS_DRILLDOWN_PATH),
    ]);

    const comparison = asObject(parity.comparison);
    const policyengineHarness = asObject(comparison.policyengineHarness);
    const policyengineNativeScores = asObject(
      comparison.policyengineNativeScores,
    );
    const baselineSlice = asObject(parity.baselineSlice);
    const comparisonMetadata = asObject(baselineSlice.comparisonMetadata);
    const tagSummaries = asObject(policyengineHarness.tag_summaries);
    const allTargets = asObject(tagSummaries.all_targets);
    const configuredRuns = discoverConfiguredRunBundles();
    const latestBundle = asObject(configuredRuns.latest_run_bundle);
    const targetRowsAvailable =
      latestBundle.target_diagnostics_exists === true;

    const headline = policyengineHarness.isPolicyEngineComparison
      ? {
          baseline_label: baselineSlice.baselineLabel ?? null,
          candidate_label: baselineSlice.candidateLabel ?? null,
          calibration_target_profile:
            baselineSlice.calibrationTargetProfile ?? null,
          n_synthetic: comparisonMetadata.n_synthetic ?? null,
          target_period: baselineSlice.targetPeriod ?? null,
          baseline_composite_parity_loss:
            policyengineHarness.baseline_composite_parity_loss ?? null,
          candidate_composite_parity_loss:
            policyengineHarness.candidate_composite_parity_loss ?? null,
          composite_parity_loss_delta:
            policyengineHarness.composite_parity_loss_delta ?? null,
          baseline_mean_abs_relative_error:
            policyengineHarness.baseline_mean_abs_relative_error ?? null,
          candidate_mean_abs_relative_error:
            policyengineHarness.candidate_mean_abs_relative_error ?? null,
          mean_abs_relative_error_delta:
            policyengineHarness.mean_abs_relative_error_delta ?? null,
          slice_win_rate: policyengineHarness.slice_win_rate ?? null,
          supported_target_rate:
            policyengineHarness.supported_target_rate ?? null,
          target_win_rate: allTargets.target_win_rate ?? null,
          tag_summaries: tagSummaries,
        }
      : {};

    return NextResponse.json(
      scrub({
        source_repo: "PolicyEngine/microplex-us",
        source_artifacts: Object.entries(ARTIFACTS).map(([name, path]) => ({
          name,
          path,
          url: `${GITHUB_RAW}/${path}`,
        })),
        limitations: [
          "Only committed microplex-us summary JSON artifacts are public.",
          "Newer Microplex run bundles write pe_native_target_diagnostics.json, but those bundles are generated artifacts, not committed public JSONs.",
          "This is aggregate Microplex target-oracle reporting, not the full row-level target performance table.",
        ],
        newer_runs: {
          current_reader: "public_github_committed_summary_jsons",
          public_branch: "PolicyEngine/microplex-us main",
          run_bundle_manifest_key: RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY,
          run_bundle_path_hint: RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
          legacy_static_dashboard_path: LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH,
          required_to_load_newer_runs:
            "Point the dashboard at a generated Microplex artifact root, publish the run-bundle JSONs, or expose the run index/artifacts through an authenticated artifact service.",
          not_loaded_reason:
            "The committed public repo only contains summary JSONs; this process can only see newer runs when MICROPLEX_ARTIFACT_ROOTS or MICROPLEX_ARTIFACT_ROOT points at generated run bundles, or when an artifact store is wired in.",
          configured_run_discovery: configuredRuns,
        },
        repo_structure: {
          canonical_stage_count: 9,
          current_commit_public_artifact_count: Object.keys(ARTIFACTS).length,
          analysis_modes: [
            "microplex_vs_target_oracle",
            "microplex_vs_us_data_comparator",
            "run_to_run_microplex_comparison",
          ],
          generated_artifacts: GENERATED_ARTIFACT_CONTRACT,
          full_target_diagnostics: {
            available_in_committed_repo: false,
            expected_path: RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
            run_level_path: RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
            manifest_key: RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY,
            legacy_static_dashboard_path: LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH,
            static_dashboard_default_url:
              `../${LEGACY_STATIC_TARGET_DIAGNOSTICS_PATH}`,
            producer_command:
              `Run the Microplex PE-US-data rebuild/native audit pipeline; newer runs record manifest.artifacts.${RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY} = ${RUN_LEVEL_TARGET_DIAGNOSTICS_PATH}.`,
            row_fields: TARGET_DIAGNOSTIC_ROW_FIELDS,
            primary_use:
              "Standalone Microplex aggregate-vs-target diagnostics; us-data baseline fields are optional comparator context.",
          },
          run_index: {
            path_hint: "run_index.duckdb",
            query_helpers: [
              "list_us_microplex_target_delta_rows",
              "compare_us_microplex_target_delta_rows",
              "select_us_microplex_frontier_index_row",
            ],
          },
        },
        artifact_id: parity.artifactId ?? null,
        verdict: parity.verdict ?? null,
        headline,
        native_scores: {
          available: policyengineNativeScores.available ?? null,
          metric: policyengineNativeScores.metric ?? null,
          period: policyengineNativeScores.period ?? null,
          baseline_enhanced_cps_native_loss:
            policyengineNativeScores.baseline_enhanced_cps_native_loss ?? null,
          candidate_enhanced_cps_native_loss:
            policyengineNativeScores.candidate_enhanced_cps_native_loss ?? null,
          enhanced_cps_native_loss_delta:
            policyengineNativeScores.enhanced_cps_native_loss_delta ?? null,
          baseline_unweighted_msre:
            policyengineNativeScores.baseline_unweighted_msre ?? null,
          candidate_unweighted_msre:
            policyengineNativeScores.candidate_unweighted_msre ?? null,
          unweighted_msre_delta:
            policyengineNativeScores.unweighted_msre_delta ?? null,
          candidate_beats_baseline:
            policyengineNativeScores.candidate_beats_baseline ?? null,
          n_targets_total: policyengineNativeScores.n_targets_total ?? null,
          n_targets_kept: policyengineNativeScores.n_targets_kept ?? null,
          n_national_targets:
            policyengineNativeScores.n_national_targets ?? null,
          n_state_targets: policyengineNativeScores.n_state_targets ?? null,
          n_targets_bad_dropped:
            policyengineNativeScores.n_targets_bad_dropped ?? null,
          n_targets_zero_dropped:
            policyengineNativeScores.n_targets_zero_dropped ?? null,
          target_rows_available: targetRowsAvailable,
          full_target_diagnostics_path:
            latestBundle.target_diagnostics_path ??
            RUN_LEVEL_TARGET_DIAGNOSTICS_PATH,
          full_target_diagnostics_manifest_key:
            RUN_LEVEL_TARGET_DIAGNOSTICS_MANIFEST_KEY,
        },
        target_diagnostics: {
          available: false,
          path: latestBundle.target_diagnostics_path ?? null,
          summary: {},
          total_targets: 0,
          display_limit: 100,
          targets: [],
        },
        regression_summary: {
          total_scored_runs: regression.totalScoredRuns ?? null,
          total_audited_runs: regression.totalAuditedRuns ?? null,
          best_runs: Array.isArray(regression.bestRuns)
            ? regression.bestRuns.slice(0, 10)
            : [],
          worst_runs: Array.isArray(regression.worstRuns)
            ? regression.worstRuns.slice(0, 10)
            : [],
          largest_family_counts: regression.largestFamilyCounts ?? {},
          top3_family_counts: regression.top3FamilyCounts ?? {},
          target_counts_from_audits: regression.targetCountsFromAudits ?? {},
        },
        irs_drilldown: {
          family: drilldown.family ?? null,
          audits_where_family_leads: drilldown.auditsWhereFamilyLeads ?? null,
          audits_with_matching_targets:
            drilldown.auditsWithMatchingTargets ?? null,
          lead_audits: Array.isArray(drilldown.leadAudits)
            ? drilldown.leadAudits.slice(0, 10)
            : [],
          lead_target_counts: drilldown.leadTargetCounts ?? {},
          lead_filing_status_gap_summary:
            drilldown.leadFilingStatusGapSummary ?? null,
          lead_mfs_agi_gap_summary: drilldown.leadMFSAgiGapSummary ?? null,
        },
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
