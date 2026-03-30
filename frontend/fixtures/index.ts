import targetsData from "./targets.json";
import weightDistributionData from "./weight-distribution.json";
import povertyRateData from "./poverty-rate.json";
import incomeDistributionData from "./income-distribution.json";
import histogramData from "./histogram.json";
import errorDecompositionData from "./error-decomposition.json";
import convergenceData from "./convergence.json";
import contributorsData from "./contributors.json";
import constraintDiffData from "./constraint-diff.json";
import householdsDistortedData from "./households-distorted.json";
import householdProfileData from "./household-profile.json";
import attributionsData from "./attributions.json";
import epochSummaryData from "./epoch-summary.json";
import decomposeData from "./decompose.json";
import provenanceData from "./provenance.json";
import stratumData from "./stratum.json";

const FIXTURES: Record<string, unknown> = {
  "/targets": targetsData,
  "/targets/search": targetsData.items?.slice(0, 5) ?? [],
  "/targets/poverty-impact": targetsData.items?.slice(0, 10) ?? [],
  "/weights/distribution": weightDistributionData,
  "/weights/histogram": histogramData,
  "/statistics/poverty-rate": povertyRateData,
  "/statistics/income-distribution": incomeDistributionData,
  "/epochs/summary": epochSummaryData,
  "/decompose": decomposeData,
};

const PARAMETRIC_FIXTURES: Record<string, unknown> = {
  "/error-decomposition": errorDecompositionData,
  "/convergence": convergenceData,
  "/contributors": contributorsData,
  "/constraint-diff": constraintDiffData,
  "/provenance": provenanceData,
  "/eligibility-audit": {
    target_name: "national/snap/[]",
    total_contributors: 845000,
    meet_criterion: 340000,
    fail_criterion: 505000,
    pct_failing: 59.8,
    weighted_contribution_from_failing: 1.8e11,
    pct_estimate_from_failing: 58.1,
    diagnosis:
      "59.8% of contributors do not meet criterion. They contribute 58.1% of the estimate.",
  },
  "/profile": householdProfileData,
  "/attributions": attributionsData,
};

export function getFixture<T>(
  path: string,
  _params?: Record<string, string | number | boolean | undefined>,
): T {
  // Exact match first
  if (path in FIXTURES) {
    return FIXTURES[path] as T;
  }

  // Parametric match: /targets/0/convergence → match "/convergence"
  for (const [suffix, data] of Object.entries(PARAMETRIC_FIXTURES)) {
    if (path.endsWith(suffix)) {
      return data as T;
    }
  }

  // Strata
  if (path.startsWith("/strata/")) {
    return stratumData as T;
  }

  // Households distorted
  if (path === "/households/distorted") {
    return householdsDistortedData as T;
  }

  console.warn(`No fixture for path: ${path}`);
  return {} as T;
}
