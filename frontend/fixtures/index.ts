import targetsData from "./targets.json";
import weightDistributionData from "./weight-distribution.json";
import histogramData from "./histogram.json";
import errorDecompositionData from "./error-decomposition.json";
import convergenceData from "./convergence.json";
import contributorsData from "./contributors.json";
import constraintDiffData from "./constraint-diff.json";
import provenanceData from "./provenance.json";
import stratumData from "./stratum.json";
import summaryData from "./summary.json";
import datasetsData from "./datasets.json";
import runsData from "./runs.json";
import { facetsFixture, listTargetsFixture } from "./synth-targets";

const FIXTURES: Record<string, unknown> = {
  "/targets/search": targetsData.items?.slice(0, 5) ?? [],
  "/targets/poverty-impact": targetsData.items?.slice(0, 10) ?? [],
  "/weights/distribution": weightDistributionData,
  "/weights/histogram": histogramData,
  "/summary": summaryData,
  "/datasets": datasetsData,
  "/runs": runsData,
  "/geography/states": [],
  "/geography/districts": [],
};

// Used by the Target Explorer detail panel (parametric on target_idx).
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
};

export function getFixture<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | (string | number)[] | null>,
): T {
  // Dynamic, params-aware fixtures
  if (path === "/targets") {
    return listTargetsFixture(params ?? {}) as T;
  }
  if (path === "/targets/facets") {
    return facetsFixture(params ?? {}) as T;
  }

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

  // Geography: /geography/districts/{state_fips} → same shape as base
  if (path.startsWith("/geography/districts")) {
    return [] as T;
  }

  // Strata
  if (path.startsWith("/strata/")) {
    return stratumData as T;
  }

  console.warn(`No fixture for path: ${path}`);
  return {} as T;
}
