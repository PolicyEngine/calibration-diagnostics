import type {
  CrossDatasetGroup,
  CrossDatasetSummary,
  SourceSummary,
} from "./artifact";

export const CROSS_DATASET_PAGE_TITLE = "Cross-dataset comparison";

export const GROUP_DIMENSIONS = [
  { key: "ledger_source", label: "Ledger source" },
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

export interface SourceOverview {
  sourceId: string;
  label: string;
  datasetVersion?: string;
  modelVersion?: string;
  scoreLabel: string;
  scoreScopeLabel: string;
  performancePercent: number | null;
  coverageLabel: string;
  coveragePercent: number;
  coveredCount: number;
  unsupportedCount: number;
  topUnsupportedReasons: LabeledCount[];
  periodTreatments: LabeledCount[];
  calibrationExposures: LabeledCount[];
}

export interface GroupSourceView {
  scoreLabel: string;
  performancePercent: number | null;
  coverageLabel: string;
  coveragePercent: number;
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
  aligned_fact: "2023 facts aligned to 2024",
  advanced_population: "CPS population advanced to 2024",
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

function percent(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function scorePercent(value: string | null | undefined): number | null {
  const parsed = number(value);
  return parsed == null ? null : Math.max(0, Math.min(100, parsed));
}

function formatScore(value: string | null | undefined, suffix = ""): string {
  const parsed = number(value);
  return parsed == null ? "Not scored" : `${parsed.toFixed(1)}${suffix}`;
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
): SourceOverview[] {
  return summary.sources.map((source) => {
    const covered = source.score.covered;
    const scored = source.score.scored;
    return {
      sourceId: source.source_id,
      label: source.label,
      datasetVersion: source.dataset_version,
      modelVersion: source.model_version,
      scoreLabel: formatScore(source.score.display_score, " / 100"),
      scoreScopeLabel: `Performance among ${scored.toLocaleString("en-US")} scored facts`,
      performancePercent: scorePercent(source.score.display_score),
      coverageLabel: `${covered.toLocaleString("en-US")} of ${summary.fact_count.toLocaleString("en-US")} facts`,
      coveragePercent: percent(covered, summary.fact_count),
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
    display_score: null,
    reason_codes: {},
  };
  const sourceSpecific =
    dimension === "period_treatment" || dimension === "calibration_exposure";
  const total = sourceSpecific ? groupCellCount(group, source.source_id) : group.fact_count;
  const unsupported = Math.max(0, total - cell.evaluable);
  return {
    scoreLabel: formatScore(cell.display_score),
    performancePercent: scorePercent(cell.display_score),
    coverageLabel: `${cell.evaluable.toLocaleString("en-US")} / ${total.toLocaleString("en-US")}`,
    coveragePercent: percent(cell.evaluable, total),
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
      label: group.label,
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
