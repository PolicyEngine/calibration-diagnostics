import type {
  CrossDatasetFact,
  FactSort,
  SourceSummary,
} from "./artifact";
import { sourceDisplayLabel } from "./presentation";

export interface FactCatalogParams {
  source: string;
  status: string;
  ledgerSource: string;
  measure: string;
  period: string;
  geography: string;
  periodTreatment: string;
  calibrationExposure: string;
  search: string;
  page: number;
  pageSize: number;
  sort: FactSort;
}

export interface DisplayField {
  label: string;
  value: string;
}

export interface FactSourceRowView {
  statusLabel: string;
  estimateLabel: string;
  errorLabel: string;
  reasonLabel: string;
  ariaLabel: string;
  supported: boolean;
}

export interface FactRowView {
  factKey: string;
  label: string;
  measure: string;
  ledgerSource: string;
  observedValue: string;
  observedPeriod: string;
  geography: string;
  detailHref: string;
  detailAriaLabel: string;
  sourceCells: Record<string, FactSourceRowView>;
}

export interface FactSourceDetailView extends FactSourceRowView {
  benchmarkLabel: string;
  benchmarkPeriodLabel: string;
  benchmarkBasisLabel: string;
  mappingLabel: string;
  executionLabel: string;
  periodTreatmentLabel: string;
  populationPeriodLabel: string;
  policyPeriodLabel: string;
  calibrationExposureLabel: string;
  requiredVariables: string[];
  alignment: DisplayField[];
  datasetVersion: string;
  modelVersion: string;
  standardErrorLabel: string;
  marginOfError90Label: string;
}

export interface FactDetailView {
  factKey: string;
  label: string;
  measure: string;
  observation: {
    valueLabel: string;
    periodLabel: string;
    sourceLabel: string;
    geographyLabel: string;
    entityLabel: string;
    unitLabel: string;
  };
  dimensions: DisplayField[];
  universe: DisplayField[];
  provenance: DisplayField[];
  sourceCells: Record<string, FactSourceDetailView>;
}

const DEFAULT_PARAMS: FactCatalogParams = {
  source: "",
  status: "",
  ledgerSource: "",
  measure: "",
  period: "",
  geography: "",
  periodTreatment: "",
  calibrationExposure: "",
  search: "",
  page: 1,
  pageSize: 100,
  sort: "fact_key",
};

const SORTS = new Set<FactSort>(["fact_key", "label", "error_desc"]);

function boundedPositiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export function parseFactCatalogParams(params: URLSearchParams): FactCatalogParams {
  const sortValue = params.get("sort") as FactSort | null;
  return {
    source: params.get("source")?.trim() ?? "",
    status: params.get("status")?.trim() ?? "",
    ledgerSource: params.get("ledger_source")?.trim() ?? "",
    measure: params.get("measure")?.trim() ?? "",
    period: params.get("period")?.trim() ?? "",
    geography: params.get("geography")?.trim() ?? "",
    periodTreatment: params.get("period_treatment")?.trim() ?? "",
    calibrationExposure: params.get("calibration_exposure")?.trim() ?? "",
    search: params.get("search")?.trim() ?? "",
    page: boundedPositiveInteger(params.get("page"), DEFAULT_PARAMS.page, Number.MAX_SAFE_INTEGER),
    pageSize: boundedPositiveInteger(params.get("page_size"), DEFAULT_PARAMS.pageSize, 250),
    sort: sortValue && SORTS.has(sortValue) ? sortValue : DEFAULT_PARAMS.sort,
  };
}

function serializeCatalogParams(
  params: FactCatalogParams,
  options: { includeView: boolean },
): URLSearchParams {
  const query = new URLSearchParams();
  if (options.includeView) query.set("view", "facts");
  const values: [string, string][] = [
    ["source", params.source],
    ["status", params.status],
    ["ledger_source", params.ledgerSource],
    ["measure", params.measure],
    ["period", params.period],
    ["geography", params.geography],
    ["period_treatment", params.periodTreatment],
    ["calibration_exposure", params.calibrationExposure],
    ["search", params.search],
  ];
  for (const [key, value] of values) {
    if (value) query.set(key, value);
  }
  if (params.page !== DEFAULT_PARAMS.page) query.set("page", String(params.page));
  if (params.pageSize !== DEFAULT_PARAMS.pageSize) {
    query.set("page_size", String(params.pageSize));
  }
  if (params.sort !== DEFAULT_PARAMS.sort) query.set("sort", params.sort);
  return query;
}

export function factCatalogHref(
  current: FactCatalogParams,
  patch: Partial<FactCatalogParams> = {},
): string {
  const next = { ...current, ...patch };
  const query = serializeCatalogParams(next, { includeView: true });
  return "/populace/datasets?" + query.toString();
}

export function factDetailHref(
  factKey: string,
  current: FactCatalogParams = DEFAULT_PARAMS,
): string {
  const query = new URLSearchParams();
  query.set("view", "fact");
  query.set("fact_key", factKey);
  const context = serializeCatalogParams(current, { includeView: false });
  for (const [key, value] of context) query.set(key, value);
  return "/populace/datasets?" + query.toString();
}

export function humanizeIdentifier(value: string): string {
  const words = value.replaceAll("_", " ").replaceAll(".", " / ");
  return words
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function sentenceIdentifier(value: string): string {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatPeriod(value: string | undefined): string {
  if (!value) return "Not available";
  const separator = value.indexOf(":");
  if (separator < 0) return humanizeIdentifier(value);
  const kind = value.slice(0, separator).replaceAll("_", " ");
  return (
    kind.charAt(0).toUpperCase() +
    kind.slice(1) +
    " " +
    value.slice(separator + 1).replaceAll("-", "–")
  );
}

export function formatFactValue(value: string | undefined, unit: string): string {
  if (value == null) return "Not available";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  const absolute = Math.abs(parsed);
  const sign = parsed < 0 ? "-" : "";
  if (unit.toLowerCase().includes("usd")) {
    if (absolute >= 1e12) return sign + "$" + (absolute / 1e12).toFixed(2) + "T";
    if (absolute >= 1e9) return sign + "$" + (absolute / 1e9).toFixed(2) + "B";
    if (absolute >= 1e6) return sign + "$" + (absolute / 1e6).toFixed(2) + "M";
    if (absolute >= 1e3) return sign + "$" + (absolute / 1e3).toFixed(1) + "K";
    return sign + "$" + absolute.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (unit.toLowerCase().includes("percent")) return parsed.toFixed(1) + "%";
  return parsed.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function reasonLabel(reasonCode: string | undefined): string {
  if (!reasonCode) return "";
  const words = reasonCode.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    evaluable_direct: "Evaluable · direct",
    evaluable_via_model: "Evaluable · via model",
    evaluable_in_sample: "Evaluable · in-sample",
    evaluable_projected: "Evaluable · projected",
    not_applicable: "Not applicable",
    unsupported_concept: "Unsupported · concept",
    unsupported_constraint: "Unsupported · constraint",
    unsupported_entity: "Unsupported · entity",
    unsupported_geography: "Unsupported · geography",
    unsupported_period: "Unsupported · period",
  };
  return labels[status] ?? humanizeIdentifier(status);
}

function sourceRowView(
  fact: CrossDatasetFact,
  source: SourceSummary,
): FactSourceRowView {
  const sourceLabel = sourceDisplayLabel(source);
  const cell = fact.sources[source.source_id];
  if (!cell) {
    return {
      statusLabel: "Missing capability cell",
      estimateLabel: "Not evaluated",
      errorLabel: "",
      reasonLabel: "No result was published",
      ariaLabel: sourceLabel + ": Missing capability cell",
      supported: false,
    };
  }
  const supported = cell.execution_method != null && cell.execution_method !== "none";
  const displayStatus = statusLabel(cell.status);
  const estimate = supported
    ? formatFactValue(cell.estimate, fact.unit)
    : "Not evaluated";
  const error = Number(cell.absolute_relative_error);
  const displayError =
    Number.isFinite(error) && cell.absolute_relative_error != null
      ? (error * 100).toFixed(1) + "% error"
      : "";
  const reason = reasonLabel(cell.reason_code);
  const spokenStatus = displayStatus.replaceAll(" · ", ", ");
  const aria = supported
    ? sourceLabel +
      ": " +
      spokenStatus +
      "; estimate " +
      estimate +
      (displayError ? "; " + displayError : "")
    : sourceLabel + ": " + spokenStatus + (reason ? "; " + reason : "");
  return {
    statusLabel: displayStatus,
    estimateLabel: estimate,
    errorLabel: displayError,
    reasonLabel: reason,
    ariaLabel: aria,
    supported,
  };
}

export function buildFactRowView(
  fact: CrossDatasetFact,
  sources: SourceSummary[],
  current: FactCatalogParams = DEFAULT_PARAMS,
): FactRowView {
  return {
    factKey: fact.fact_key,
    label: fact.label,
    measure: fact.measure,
    ledgerSource: humanizeIdentifier(fact.ledger_source),
    observedValue: formatFactValue(fact.observed_value, fact.unit),
    observedPeriod: formatPeriod(fact.observed_period),
    geography: humanizeIdentifier(fact.geography_level),
    detailHref: factDetailHref(fact.fact_key, current),
    detailAriaLabel: "View Chronicle fact " + fact.label,
    sourceCells: Object.fromEntries(
      sources.map((source) => [source.source_id, sourceRowView(fact, source)]),
    ),
  };
}

function fields(value: Record<string, unknown> | undefined): DisplayField[] {
  if (!value) return [];
  return Object.entries(value).map(([key, fieldValue]) => ({
    label: humanizeIdentifier(key),
    value:
      typeof fieldValue === "string"
        ? fieldValue
        : JSON.stringify(fieldValue),
  }));
}

function sourceDetailView(
  fact: CrossDatasetFact,
  source: SourceSummary,
): FactSourceDetailView {
  const row = sourceRowView(fact, source);
  const cell = fact.sources[source.source_id];
  if (!cell) {
    return {
      ...row,
      benchmarkLabel: "Not available",
      benchmarkPeriodLabel: "Not available",
      benchmarkBasisLabel: "Not available",
      mappingLabel: "Not mapped",
      executionLabel: "Not executed",
      periodTreatmentLabel: "Not available",
      populationPeriodLabel: "Not available",
      policyPeriodLabel: "Not available",
      calibrationExposureLabel: "Not available",
      requiredVariables: [],
      alignment: [],
      datasetVersion: source.dataset_version ?? "Not recorded",
      modelVersion: source.model_version ?? "Not applicable",
      standardErrorLabel: "Not available",
      marginOfError90Label: "Not available",
    };
  }
  const exposureLabels: Record<string, string> = {
    direct_calibration_target: "Direct calibration target (in-sample)",
    used_in_imputation_or_reweighting:
      "Used in source weighting/reweighting (not independent)",
    external_validation: "External validation",
    unknown_exposure: "Not evaluated",
  };
  return {
    ...row,
    reasonLabel: cell.reason_detail ?? row.reasonLabel,
    benchmarkLabel: formatFactValue(cell.benchmark_value, fact.unit),
    benchmarkPeriodLabel: formatPeriod(cell.benchmark_period),
    benchmarkBasisLabel: cell.benchmark_basis
      ? sentenceIdentifier(cell.benchmark_basis)
      : "Not available",
    mappingLabel: cell.mapping_id ?? "Not mapped",
    executionLabel:
      cell.execution_method && cell.execution_method !== "none"
        ? humanizeIdentifier(cell.execution_method) +
          (cell.mapping_quality ? " · " + humanizeIdentifier(cell.mapping_quality).toLowerCase() : "")
        : "Not executed",
    periodTreatmentLabel: cell.period_treatment
      ? sentenceIdentifier(cell.period_treatment)
      : "Not available",
    populationPeriodLabel: formatPeriod(cell.population_period),
    policyPeriodLabel: formatPeriod(cell.policy_period),
    calibrationExposureLabel:
      exposureLabels[cell.calibration_exposure ?? ""] ??
      humanizeIdentifier(cell.calibration_exposure ?? "not available"),
    requiredVariables: cell.required_variables ?? [],
    alignment: fields(cell.alignment),
    datasetVersion: cell.dataset_version ?? source.dataset_version ?? "Not recorded",
    modelVersion: cell.model_version ?? source.model_version ?? "Not applicable",
    standardErrorLabel: formatFactValue(cell.standard_error, fact.unit),
    marginOfError90Label: formatFactValue(cell.margin_of_error_90, fact.unit),
  };
}

export function buildFactDetailView(
  fact: CrossDatasetFact,
  sources: SourceSummary[],
): FactDetailView {
  const provenanceOrder: [string, string][] = [
    ["source_record_id", "Source record"],
    ["source_table", "Source table"],
    ["url", "Source URL"],
    ["vintage", "Vintage"],
    ["source_sha256", "Source SHA-256"],
    ["raw_r2_uri", "Raw archive"],
    ["semantic_fact_key", "Semantic fact key"],
    ["provenance_class", "Provenance class"],
  ];
  const provenance = fact.provenance ?? {};
  return {
    factKey: fact.fact_key,
    label: fact.label,
    measure: fact.measure,
    observation: {
      valueLabel: formatFactValue(fact.observed_value, fact.unit),
      periodLabel: formatPeriod(fact.observed_period),
      sourceLabel: humanizeIdentifier(fact.ledger_source),
      geographyLabel:
        humanizeIdentifier(fact.geography_level) + " · " + fact.geography_id,
      entityLabel: humanizeIdentifier(fact.entity),
      unitLabel: humanizeIdentifier(fact.unit),
    },
    dimensions: fields(fact.dimensions),
    universe: (fact.universe_constraints ?? []).flatMap((constraint) => fields(constraint)),
    provenance: provenanceOrder.flatMap(([key, label]) => {
      const value = provenance[key];
      return value == null ? [] : [{ label, value: String(value) }];
    }),
    sourceCells: Object.fromEntries(
      sources.map((source) => [source.source_id, sourceDetailView(fact, source)]),
    ),
  };
}
