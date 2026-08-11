import type {
  CrossDatasetGroup,
  CrossDatasetSummary,
  PerformanceBuckets,
  SourceSummary,
} from "./artifact";
import { sourceAuthorityLabel } from "../source-labels";

export const CROSS_DATASET_PAGE_TITLE = "Cross-dataset comparison";

export const GROUP_DIMENSIONS = [
  { key: "ledger_source", label: "Chronicle source" },
  { key: "concept", label: "Concept" },
  { key: "period", label: "Period" },
  { key: "geography", label: "Geography" },
  { key: "period_treatment", label: "Period treatment" },
  { key: "calibration_exposure", label: "Calibration exposure" },
] as const;

export type GroupDimension = (typeof GROUP_DIMENSIONS)[number]["key"];

export interface LabeledCount {
  key: string;
  label: string;
  count: number;
}

export interface TargetPerformanceBuckets {
  withinBounds: number;
  outsideBounds: number;
  farOutsideBounds: number;
  unavailable: number;
  total: number;
}

export interface SourceOverview {
  sourceId: string;
  label: string;
  datasetVersion?: string;
  modelVersion?: string;
  scoreLabel: string;
  coverageRateLabel: string;
  scoreScopeLabel: string;
  performanceBuckets: TargetPerformanceBuckets;
  coverageLabel: string;
  coveredCount: number;
  unsupportedCount: number;
  topUnsupportedReasons: LabeledCount[];
  periodTreatments: LabeledCount[];
  calibrationExposures: LabeledCount[];
}

export type OverviewGeographyFilter =
  | "all"
  | "country"
  | "state"
  | "congressional_district";
export type OverviewSampleFilter = "all" | "in_sample" | "out_of_sample";

export interface SourceOverviewFilter {
  geography: OverviewGeographyFilter;
  sample: OverviewSampleFilter;
}

export interface GroupSourceView {
  scoreLabel: string;
  performanceBuckets: TargetPerformanceBuckets;
  coverageLabel: string;
  evaluableCount: number;
  scoredCount: number;
  unsupportedCount: number;
  topUnsupportedReasons: LabeledCount[];
  factHref: string;
}

export interface GroupRowView {
  dimension: GroupDimension;
  key: string;
  label: string;
  factCount: number;
  sources: Record<string, GroupSourceView>;
}

export type CrossDatasetUiState = "loading" | "error" | "empty" | "ready";

export function crossDatasetUiState(input: {
  isLoading?: boolean;
  error?: unknown;
  summary?: CrossDatasetSummary;
}): CrossDatasetUiState {
  if (input.isLoading) return "loading";
  if (input.error || !input.summary) return "error";
  return input.summary.sources.length > 0 ? "ready" : "empty";
}

const PERIOD_TREATMENT_LABELS: Record<string, string> = {
  native: "Native-period comparisons",
  aligned_fact: "Chronicle facts transformed to model-comparable benchmarks",
  advanced_population: "CPS population advanced to 2024",
  build_target_reproduction: "Administrative-period targets used by the 2024 build",
  unsupported: "Period treatment unavailable",
};

const CALIBRATION_EXPOSURE_LABELS: Record<string, string> = {
  direct_calibration_target: "Direct calibration targets (in-sample)",
  used_in_imputation_or_reweighting:
    "Used in source weighting/reweighting (not independent)",
  external_validation: "External validation",
  unknown_exposure: "Not evaluated",
};

function titleCase(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function number(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatError(value: string | null | undefined): string {
  const parsed = number(value);
  return parsed == null ? "Not scored" : `${(parsed * 100).toFixed(1)}% mean error`;
}

function formatCoverageRate(covered: number, total: number): string {
  return total > 0
    ? `${((covered / total) * 100).toFixed(1)}% coverage`
    : "Coverage unavailable";
}

function performanceBuckets(
  value: PerformanceBuckets,
): TargetPerformanceBuckets {
  return {
    withinBounds: value.within_bounds,
    outsideBounds: value.outside_bounds,
    farOutsideBounds: value.far_outside_bounds,
    unavailable: value.unavailable,
    total: value.total,
  };
}

function labeledCounts(
  values: Record<string, number>,
  labels: Record<string, string> = {},
): LabeledCount[] {
  return Object.entries(values)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      label: labels[key] ?? titleCase(key),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function groupCellCount(group: CrossDatasetGroup, sourceId: string): number {
  const cell = group.sources[sourceId];
  if (!cell) return 0;
  return cell.evaluable + Object.values(cell.reason_codes).reduce((sum, value) => sum + value, 0);
}

function sourceCategories(
  groups: CrossDatasetGroup[],
  dimension: "period_treatment" | "calibration_exposure",
  sourceId: string,
): LabeledCount[] {
  const labels =
    dimension === "period_treatment"
      ? PERIOD_TREATMENT_LABELS
      : CALIBRATION_EXPOSURE_LABELS;
  return groups
    .filter((group) => group.dimension === dimension)
    .map((group) => ({
      key: group.key,
      label: labels[group.key] ?? group.label,
      count: groupCellCount(group, sourceId),
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function buildSourceOverviews(
  summary: CrossDatasetSummary,
  groups: CrossDatasetGroup[],
  filters: Record<string, Partial<SourceOverviewFilter>> = {},
): SourceOverview[] {
  return orderSourceSummaries(summary.sources).map((source) => {
    const filter = filters[source.source_id] ?? {};
    const geography = filter.geography ?? "all";
    const sample = filter.sample ?? "all";
    const filterActive = geography !== "all" || sample !== "all";
    const exposure =
      sample === "in_sample"
        ? "direct_calibration_target"
        : sample === "out_of_sample"
          ? "external_validation"
          : null;
    const filteredGroup =
      geography === "all" && exposure == null
        ? null
        : groups.find((group) => {
            if (geography !== "all" && exposure != null) {
              return (
                group.dimension === "geography_calibration_exposure" &&
                group.key === `${geography}|${exposure}`
              );
            }
            if (geography !== "all") {
              return group.dimension === "geography" && group.key === geography;
            }
            return group.dimension === "calibration_exposure" && group.key === exposure;
          });
    const filteredCell =
      filteredGroup?.sources[source.source_id] ??
      (filterActive
        ? {
            evaluable: 0,
            scored: 0,
            relative_error_count: 0,
            display_score: null,
            loss: null,
            performance_buckets: {
              within_bounds: 0,
              outside_bounds: 0,
              far_outside_bounds: 0,
              unavailable: 0,
              total: 0,
            },
            reason_codes: {},
          }
        : undefined);
    const score = filteredCell ?? source.score;
    const buckets = filteredCell?.performance_buckets ?? source.performance_buckets;
    const covered = filteredCell?.evaluable ?? source.score.covered;
    const comparable = score.relative_error_count ?? score.scored;
    const coverageUniverse =
      geography === "all"
        ? summary.fact_count
        : (groups.find(
            (group) => group.dimension === "geography" && group.key === geography,
          )?.fact_count ?? summary.fact_count);
    return {
      sourceId: source.source_id,
      label: sourceDisplayLabel(source),
      datasetVersion: source.dataset_version,
      modelVersion: source.model_version,
      scoreLabel: formatError(score.loss),
      coverageRateLabel: formatCoverageRate(covered, coverageUniverse),
      scoreScopeLabel: `Mean capped error across ${comparable.toLocaleString("en-US")} comparable facts`,
      performanceBuckets: performanceBuckets(buckets),
      coverageLabel: `${covered.toLocaleString("en-US")} of ${coverageUniverse.toLocaleString("en-US")} facts`,
      coveredCount: covered,
      unsupportedCount: Math.max(0, source.capability_count - source.result_count),
      topUnsupportedReasons: labeledCounts(source.reason_codes).slice(0, 3),
      periodTreatments: sourceCategories(groups, "period_treatment", source.source_id),
      calibrationExposures: sourceCategories(
        groups,
        "calibration_exposure",
        source.source_id,
      ),
    };
  });
}

export function sourceDisplayLabel(source: SourceSummary): string {
  if (
    source.source_id === "taxcalc_public_cps_2024" ||
    source.source_id === "cps"
  ) {
    return "Public CPS + Tax-Calculator";
  }
  return source.label.replaceAll("Populace", "Microcosm").replaceAll("Ledger", "Chronicle");
}

export function orderSourceSummaries(sources: SourceSummary[]): SourceSummary[] {
  const sourcePriority = (source: SourceSummary): number => {
    const sourceId = source.source_id.toLowerCase();
    if (sourceId.includes("populace")) return 0;
    if (sourceId === "taxcalc_public_cps_2024" || sourceId === "cps") return 1;
    return 2;
  };
  return sources
    .map((source, index) => ({ source, index }))
    .sort((left, right) => {
      const priorityDifference = sourcePriority(left.source) - sourcePriority(right.source);
      if (priorityDifference !== 0) return priorityDifference;
      return left.index - right.index;
    })
    .map(({ source }) => source);
}

const DIMENSION_QUERY_KEYS: Record<GroupDimension, string> = {
  ledger_source: "ledger_source",
  concept: "measure",
  period: "period",
  geography: "geography",
  period_treatment: "period_treatment",
  calibration_exposure: "calibration_exposure",
};

export function groupFactsHref(
  dimension: GroupDimension,
  key: string,
  sourceId: string,
): string {
  const params = new URLSearchParams();
  params.set("view", "facts");
  params.set("source", sourceId);
  params.set(DIMENSION_QUERY_KEYS[dimension], key);
  return `/populace/datasets?${params.toString()}`;
}

function sourceGroupView(
  group: CrossDatasetGroup,
  dimension: GroupDimension,
  source: SourceSummary,
): GroupSourceView {
  const cell = group.sources[source.source_id] ?? {
    evaluable: 0,
    scored: 0,
    relative_error_count: 0,
    display_score: null,
    loss: null,
    performance_buckets: {
      within_bounds: 0,
      outside_bounds: 0,
      far_outside_bounds: 0,
      unavailable: 0,
      total: 0,
    },
    reason_codes: {},
  };
  const sourceSpecific =
    dimension === "period_treatment" || dimension === "calibration_exposure";
  const total = sourceSpecific ? groupCellCount(group, source.source_id) : group.fact_count;
  const unsupported = Math.max(0, total - cell.evaluable);
  return {
    scoreLabel: formatError(cell.loss),
    performanceBuckets: performanceBuckets(cell.performance_buckets),
    coverageLabel: `${cell.evaluable.toLocaleString("en-US")} / ${total.toLocaleString("en-US")}`,
    evaluableCount: cell.evaluable,
    scoredCount: cell.scored,
    unsupportedCount: unsupported,
    topUnsupportedReasons: labeledCounts(cell.reason_codes).slice(0, 2),
    factHref: groupFactsHref(dimension, group.key, source.source_id),
  };
}

export function buildGroupRows(
  groups: CrossDatasetGroup[],
  dimension: GroupDimension,
  sources: SourceSummary[],
): GroupRowView[] {
  return groups
    .filter((group) => group.dimension === dimension)
    .map((group) => ({
      dimension,
      key: group.key,
      label:
        dimension === "ledger_source"
          ? sourceAuthorityLabel(group.key)
          : group.label,
      factCount: group.fact_count,
      sources: Object.fromEntries(
        sources.map((source) => [
          source.source_id,
          sourceGroupView(group, dimension, source),
        ]),
      ),
    }))
    .sort((left, right) => right.factCount - left.factCount || left.label.localeCompare(right.label));
}
