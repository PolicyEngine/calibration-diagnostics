import { NextResponse } from "next/server";

const GITHUB_RAW = "https://raw.githubusercontent.com/PolicyEngine/microplex-us/main";

const PARITY_PATH =
  "artifacts/live_pe_native_cps_puf_rich_broad_fixed_20260329/20260329T175330Z-057066af/pe_us_data_rebuild_parity.json";
const REGRESSION_SUMMARY_PATH =
  "artifacts/live_pe_us_data_rebuild_checkpoint_modelpass_regression_summary_20260410.json";
const IRS_DRILLDOWN_PATH =
  "artifacts/live_pe_us_data_rebuild_checkpoint_national_irs_other_drilldown_20260410.json";

const ARTIFACTS = {
  parity: PARITY_PATH,
  regression_summary: REGRESSION_SUMMARY_PATH,
  irs_drilldown: IRS_DRILLDOWN_PATH,
};

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
    const baselineSlice = asObject(parity.baselineSlice);
    const comparisonMetadata = asObject(baselineSlice.comparisonMetadata);
    const tagSummaries = asObject(policyengineHarness.tag_summaries);
    const allTargets = asObject(tagSummaries.all_targets);

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
          "Only committed microplex-us JSON artifacts are public.",
          "Microplex h5 output and per-target diagnostics are not published to HuggingFace yet.",
          "This is aggregate parity/regression reporting, not a target-by-target dataset-file comparison.",
        ],
        artifact_id: parity.artifactId ?? null,
        verdict: parity.verdict ?? null,
        headline,
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
