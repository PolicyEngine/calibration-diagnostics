// Pure-HF data layer for the populace-US dashboard. No committed snapshot:
// every release's manifests and per-target calibration diagnostics are read
// live from the policyengine/populace-us Hugging Face dataset, resolved through
// latest.json (current release) or by id (any release, for version compare).

type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;
export type CalibrationLossKind = "normalized_target_loss" | "raw_optimizer_objective";
export type ComparisonScope = "healthcare";

export const POPULACE_HF_REPO = process.env.POPULACE_HF_REPO ?? "policyengine/populace-us";
export const POPULACE_HF_REVISION = process.env.POPULACE_HF_REVISION ?? "main";

// Populace ships one HF dataset per country. US is public; UK is private and
// needs an HF token on the server.
export type PopulaceCountry = "us" | "uk";

const COUNTRY_REPO: Record<PopulaceCountry, { repo: string; revision: string }> = {
  us: { repo: POPULACE_HF_REPO, revision: POPULACE_HF_REVISION },
  uk: {
    repo: process.env.POPULACE_UK_HF_REPO ?? "policyengine/populace-uk-private",
    revision: process.env.POPULACE_UK_HF_REVISION ?? "main",
  },
};

export function parseCountry(value: string | null | undefined): PopulaceCountry {
  return value === "uk" ? "uk" : "us";
}

export function populaceRepo(country: PopulaceCountry): string {
  return COUNTRY_REPO[country].repo;
}

function hfAuthHeaders(): HeadersInit | undefined {
  const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

// --- name decomposition (matches populace.dev's parse_target) ---------------
const FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};
const STATE_ABBRS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "US",
]);
const FILING_MODIFIERS = new Set(["Surviving Spouse"]);
const FILING_STATUSES = new Set([
  "All", "Single", "Head of Household", "Married Filing Jointly",
  "Married Filing Separately", "Surviving Spouse",
]);
const RETURN_TYPES = new Set(["taxable", "all returns", "nontaxable"]);
const MEASURES = new Set(["total", "count", "mean", "filers", "nonfilers"]);
const QUALIFYING_CHILDREN = new Set([
  "all children",
  "no children",
  "no qualifying children",
  "one child",
  "one qualifying child",
  "two children",
  "two qualifying children",
  "three or more children",
  "three or more qualifying children",
]);

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([k, v]) => [k, scrub(v)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function calibrationLossKind(
  diag: JsonObject,
  buildManifest: JsonObject,
): CalibrationLossKind {
  const options = asObject(diag.options);
  if (
    options.target_loss_scales != null ||
    options.target_loss_weights != null ||
    buildManifest.target_loss_weighting != null ||
    buildManifest.target_loss_cap != null
  ) {
    return "normalized_target_loss";
  }
  return "raw_optimizer_objective";
}

function relativeError(estimate: number | null, target: number | null): number | null {
  if (estimate == null || target == null) return null;
  return target === 0 ? estimate - target : (estimate - target) / Math.abs(target);
}

interface ParsedTarget {
  geography: string;
  level: string;
  source: string;
  variable: string;
  breakdown: string;
}

interface TargetBreakdownDimension {
  key: string;
  label: string;
  value: string;
  source_key?: string;
  raw_value?: string;
}

interface LedgerFilter {
  key: string;
  label: string;
  value: string;
  raw_value?: string;
}

interface LedgerFactFields {
  fact_key: string | null;
  source_record_id: string | null;
  semantic_fact_key: string | null;
  aggregate_fact_key: string | null;
  legacy_fact_key: string | null;
  period_type: string | null;
  source_period: string | null;
  target_period: string | null;
  geography_level: string | null;
  geography_id: string | null;
  geography_vintage: string | null;
  domain: string | null;
  entity_name: string | null;
  entity_role: string | null;
  measure_concept: string | null;
  source_concept: string | null;
  concept_relation: string | null;
  concept_authority: string | null;
  measure_unit: string | null;
  value_operation: string | null;
  layout_record_set_id: string | null;
  layout_groupby_dimension: string | null;
  layout_groupby_value_id: string | null;
  layout_measure_id: string | null;
  dimension_set_key: string | null;
  universe_constraint_set_key: string | null;
  universe_constraint_count: number | null;
  filters: LedgerFilter[];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stateFromGeoId(value: string | null): string | null {
  if (!value) return null;
  const match = /US(\d{2})$/.exec(value);
  return match ? FIPS_TO_ABBR[match[1]] ?? null : null;
}

function readableToken(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ");
}

function titleCase(value: string): string {
  return value
    .replace(/[_:./#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function dimensionKey(label: string): string {
  return `bd_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function addDimension(
  dimensions: TargetBreakdownDimension[],
  label: string,
  value: string | null,
  sourceKey?: string,
  rawValue?: string | null,
) {
  if (!value) return;
  const normalized = value.trim();
  if (!normalized) return;
  const key = dimensionKey(label);
  if (dimensions.some((dim) => dim.key === key && dim.value === normalized)) return;
  dimensions.push({
    key,
    label,
    value: normalized,
    source_key: sourceKey,
    raw_value: rawValue ?? undefined,
  });
}

function variableFromMeasure(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/_(amount|returns|claims|count|total|collections|projected_amount)$/, "");
}

function breakdownFromSourceMeasure(
  variable: string | null,
  measureId: string | null,
): string | null {
  if (!variable || !measureId) return null;
  const variablePrefix = variable.replace(/\s+/g, "_").toLowerCase();
  const measure = measureId.toLowerCase();
  if (!measure.startsWith(`${variablePrefix}_`)) return null;
  const detail = measure
    .slice(variablePrefix.length + 1)
    .replace(/_(amount|returns|claims|count|total|collections|projected_amount)$/, "");
  if (
    variablePrefix === "eitc" &&
    ["amount", "returns", "claims", "count", "total"].includes(detail)
  ) {
    return "all children";
  }
  if (
    ["amount", "returns", "claims", "count", "total", "collections", "projected_amount"].includes(detail)
  ) {
    return null;
  }
  if (!detail || MEASURES.has(detail)) return null;
  return readableToken(detail);
}

function qualifyingChildrenFromRecordSet(value: string | null): string | null {
  if (!value) return null;
  const match = /\.eitc_by_agi_children\.([^.]+)$/.exec(value);
  if (!match) return null;
  const childGroup = match[1];
  if (childGroup === "no_qualifying_children") return "no qualifying children";
  if (childGroup === "one_qualifying_child") return "one qualifying child";
  if (childGroup === "two_qualifying_children") return "two qualifying children";
  if (childGroup === "three_or_more_qualifying_children") {
    return "three or more qualifying children";
  }
  return readableToken(childGroup);
}

function qualifyingChildrenFromCount(value: string | null): string | null {
  if (value == null) return null;
  if (value === "0") return "no qualifying children";
  if (value === "1") return "one qualifying child";
  if (value === "2") return "two qualifying children";
  if (value === "3" || value === "3+" || value === "3plus") {
    return "three or more qualifying children";
  }
  return readableToken(value);
}

function qualifyingChildrenFromSourceMeasure(variable: string | null, value: string | null): string | null {
  if (variable !== "eitc" || !value) return null;
  if (/^eitc_(amount|claims|returns|total)$/.test(value)) return "all qualifying children";
  if (/^eitc_no_children_/.test(value)) return "no qualifying children";
  if (/^eitc_one_child_/.test(value)) return "one qualifying child";
  if (/^eitc_two_children_/.test(value)) return "two qualifying children";
  if (/^eitc_three_or_more_children_/.test(value)) {
    return "three or more qualifying children";
  }
  return null;
}

function measureFromName(value: string | null): string | null {
  if (!value) return null;
  if (/_amount$|_total$|_collections$|_projected_amount$/.test(value)) return "total";
  if (/_returns$|_claims$|_count$/.test(value)) return "count";
  return null;
}

function measureFromMetadata(metadata: JsonObject): string | null {
  const sourceMeasure = stringValue(metadata.source_measure_id);
  const namedMeasure = measureFromName(sourceMeasure);
  if (namedMeasure) return namedMeasure;
  const unit = stringValue(metadata.ledger_measure_unit);
  if (stringValue(metadata.count) === "true" || unit === "count") return "count";
  if (unit === "usd") return "total";
  return null;
}

function dimensionLabel(value: string | null): string {
  if (!value) return "Breakdown";
  if (value === "us:statutes/26/62#adjusted_gross_income") return "Income band";
  if (value === "census_stc.item") return "Item";
  if (value === "hhs_acf_tanf.spending_category") return "Spending category";
  if (value.startsWith("cms_medicaid.")) return titleCase(value.replace(/^cms_medicaid\./, ""));
  const hash = value.split("#").at(-1);
  const last = hash?.split(".").at(-1) ?? value;
  return titleCase(last);
}

function filterDimensionLabel(key: string): string {
  const suffix = key.replace(/^ledger_filter_/, "");
  if (suffix === "income_range") return "Income band";
  if (suffix === "filing_status") return "Filing status";
  if (suffix === "eitc_child_count") return "Qualifying children";
  return dimensionLabel(suffix);
}

function isGeographyLayoutDimension(value: string | null): boolean {
  return [
    "geography",
    "state",
    "cms_medicaid.state_abbreviation",
  ].includes(value ?? "");
}

function isRedundantGeographyValue(metadata: JsonObject, value: string | null): boolean {
  if (!value) return false;
  const geography = stateFromGeoId(stringValue(metadata.ledger_geography_id));
  return Boolean(geography && value.toLowerCase() === geography.toLowerCase());
}

function readableDimensionValue(value: string | null): string | null {
  if (!value) return null;
  if (value === "all") return "All";
  if (value === "total") return "Total";
  return readableToken(value);
}

function readableFilterValue(key: string, value: string | null): string | null {
  if (key === "ledger_filter_eitc_child_count") {
    return qualifyingChildrenFromCount(value);
  }
  return readableDimensionValue(value);
}

function ledgerFilters(metadata: JsonObject): LedgerFilter[] {
  return Object.entries(metadata)
    .filter(([key, raw]) => key.startsWith("ledger_filter_") && stringValue(raw))
    .map(([key, raw]) => {
      const rawValue = stringValue(raw)!;
      return {
        key,
        label: filterDimensionLabel(key),
        value: readableFilterValue(key, rawValue) ?? rawValue,
        raw_value: rawValue,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

function ledgerFactFields(metadata: JsonObject): LedgerFactFields {
  return {
    fact_key: stringValue(metadata.ledger_fact_key),
    source_record_id: stringValue(metadata.ledger_source_record_id),
    semantic_fact_key: stringValue(metadata.ledger_semantic_fact_key),
    aggregate_fact_key: stringValue(metadata.ledger_aggregate_fact_key),
    legacy_fact_key: stringValue(metadata.ledger_legacy_fact_key),
    period_type: stringValue(metadata.ledger_period_type),
    source_period: stringValue(metadata.source_period),
    target_period: stringValue(metadata.target_period),
    geography_level: stringValue(metadata.ledger_geography_level),
    geography_id: stringValue(metadata.ledger_geography_id),
    geography_vintage: stringValue(metadata.ledger_geography_vintage),
    domain: stringValue(metadata.ledger_domain),
    entity_name: stringValue(metadata.ledger_entity_name),
    entity_role: stringValue(metadata.ledger_entity_role),
    measure_concept: stringValue(metadata.ledger_measure_concept),
    source_concept: stringValue(metadata.ledger_source_concept),
    concept_relation: stringValue(metadata.ledger_concept_relation),
    concept_authority: stringValue(metadata.ledger_concept_authority),
    measure_unit: stringValue(metadata.ledger_measure_unit),
    value_operation: stringValue(metadata.ledger_value_operation),
    layout_record_set_id: stringValue(metadata.ledger_layout_record_set_id),
    layout_groupby_dimension: stringValue(metadata.ledger_layout_groupby_dimension),
    layout_groupby_value_id: stringValue(metadata.ledger_layout_groupby_value_id),
    layout_measure_id: stringValue(metadata.ledger_layout_measure_id),
    dimension_set_key: stringValue(metadata.ledger_dimension_set_key),
    universe_constraint_set_key: stringValue(metadata.ledger_universe_constraint_set_key),
    universe_constraint_count: numberOrNull(metadata.ledger_universe_constraint_count),
    filters: ledgerFilters(metadata),
  };
}

function isDuplicateDimension(
  dimensions: TargetBreakdownDimension[],
  label: string,
  value: string | null,
): boolean {
  if (!value) return false;
  const key = dimensionKey(label);
  return dimensions.some((dim) => dim.key === key && dim.value === value);
}

function sourceMeasureDetail(metadata: JsonObject): string | null {
  const variable = stringValue(metadata.variable);
  const sourceMeasure = stringValue(metadata.source_measure_id);
  if (!variable || !sourceMeasure) return null;
  const variablePrefix = variable.replace(/\s+/g, "_").toLowerCase();
  const measure = sourceMeasure.toLowerCase();
  if (!measure.startsWith(`${variablePrefix}_`)) return null;
  const detail = measure
    .slice(variablePrefix.length + 1)
    .replace(/_(amount|returns|claims|count|total|collections|projected_amount)$/, "");
  if (!detail || MEASURES.has(detail)) return null;
  if (["amount", "returns", "claims", "count", "total", "collections", "projected_amount"].includes(detail)) {
    return null;
  }
  return readableToken(detail);
}

function metadataDimensions(row: TargetRow): TargetBreakdownDimension[] | null {
  const metadata = asObject(row.metadata);
  if (!Object.keys(metadata).length) return null;
  const dimensions: TargetBreakdownDimension[] = [];
  const layoutDimension = stringValue(metadata.ledger_layout_groupby_dimension);
  const layoutValue = stringValue(metadata.ledger_layout_groupby_value_id);
  if (
    layoutValue &&
    !isGeographyLayoutDimension(layoutDimension) &&
    !isRedundantGeographyValue(metadata, layoutValue)
  ) {
    addDimension(
      dimensions,
      dimensionLabel(layoutDimension),
      readableDimensionValue(layoutValue),
      "ledger_layout_groupby_value_id",
      layoutValue,
    );
  }
  for (const [key, raw] of Object.entries(metadata)) {
    if (!key.startsWith("ledger_filter_")) continue;
    const rawValue = stringValue(raw);
    if (!rawValue) continue;
    const label = filterDimensionLabel(key);
    const value = readableFilterValue(key, rawValue);
    if (isDuplicateDimension(dimensions, label, value)) continue;
    addDimension(dimensions, label, value, key, rawValue);
  }
  addDimension(
    dimensions,
    "Qualifying children",
    qualifyingChildrenFromCount(stringValue(metadata.ledger_filter_eitc_child_count)) ??
      qualifyingChildrenFromRecordSet(stringValue(metadata.ledger_layout_record_set_id)) ??
      qualifyingChildrenFromSourceMeasure(
        stringValue(metadata.variable),
        stringValue(metadata.source_measure_id),
      ),
    stringValue(metadata.ledger_filter_eitc_child_count)
      ? "ledger_filter_eitc_child_count"
      : stringValue(metadata.ledger_layout_record_set_id)
        ? "ledger_layout_record_set_id"
        : "source_measure_id",
    stringValue(metadata.ledger_filter_eitc_child_count) ??
      stringValue(metadata.ledger_layout_record_set_id) ??
      stringValue(metadata.source_measure_id),
  );
  addDimension(dimensions, "Filing status", stringValue(metadata.filing_status));
  const sourceDetail = sourceMeasureDetail(metadata);
  const hasExplicitChildDimension = dimensions.some((dim) => dim.label === "Qualifying children");
  const sourceDetailIsChildDimension = Boolean(sourceDetail && /child|children/.test(sourceDetail));
  if (
    sourceDetail &&
    !(hasExplicitChildDimension && sourceDetailIsChildDimension) &&
    !dimensions.some((dim) => dim.value === sourceDetail)
  ) {
    addDimension(dimensions, "Source measure detail", sourceDetail, "source_measure_id", stringValue(metadata.source_measure_id));
  }
  return dimensions;
}

function parseDottedTarget(name: string, row: TargetRow): ParsedTarget | null {
  if (!name.includes(".")) return null;
  const metadata = asObject(row.metadata);
  const registry = asObject(row.registry);
  const parts = name.split(".");
  const source = stringValue(registry.family) ?? parts[0] ?? "";
  const geoLevel = stringValue(metadata.ledger_geography_level);
  const geoId = stringValue(metadata.ledger_geography_id);
  const geography =
    geoLevel === "country"
      ? "United States"
      : stateFromGeoId(geoId) ?? stringValue(metadata.state) ?? "";
  const level =
    geoLevel === "country" ? "national" : geoLevel === "state" ? "state" : "";
  const measureId = stringValue(metadata.source_measure_id) ?? parts.at(-1) ?? "";
  const variable =
    readableToken(stringValue(metadata.variable)) ??
    readableToken(variableFromMeasure(measureId)) ??
    readableToken(parts.at(-2) ?? null) ??
    "";
  const childBreakdown = qualifyingChildrenFromRecordSet(
    stringValue(metadata.ledger_layout_record_set_id),
  );
  const breakdown = [
    readableToken(stringValue(metadata.ledger_layout_groupby_value_id)),
    childBreakdown ?? breakdownFromSourceMeasure(variable, measureId),
    readableToken(stringValue(metadata.filing_status)),
  ]
    .filter((value): value is string => Boolean(value && value !== variable))
    .join(" · ");

  return { geography, level, source, variable, breakdown };
}

function parseTarget(name: string): ParsedTarget {
  const parts = name.split("/");
  const p0 = parts[0] ?? "";
  const fips = /^US(\d{2})$/.exec(p0);
  if (fips) {
    return {
      geography: FIPS_TO_ABBR[fips[1]] ?? p0,
      level: "state",
      source: "admin",
      variable: parts[1] ?? "",
      breakdown: parts.slice(2).join(" · "),
    };
  }
  if (p0 === "state") {
    const second = parts[1] ?? "";
    if (STATE_ABBRS.has(second) && second !== "US") {
      return {
        geography: second, level: "state", source: "state",
        variable: parts[2] ?? "", breakdown: parts.slice(3).join(" · "),
      };
    }
    const last = parts[parts.length - 1];
    if (parts.length >= 4 && STATE_ABBRS.has(last)) {
      return {
        geography: last, level: "state", source: parts[1] ?? "",
        variable: parts[2] ?? "", breakdown: parts.slice(3, -1).join(" · "),
      };
    }
    return {
      geography: "state", level: "state", source: parts[1] ?? "",
      variable: parts[2] ?? "", breakdown: parts.slice(3).join(" · "),
    };
  }
  if (p0 === "nation" || p0 === "national" || p0 === "us") {
    return {
      geography: "United States", level: "national", source: parts[1] ?? "",
      variable: parts[2] ?? "", breakdown: parts.slice(3).join(" · "),
    };
  }
  return {
    geography: "", level: "", source: p0,
    variable: parts[1] ?? "", breakdown: parts.slice(2).join(" · "),
  };
}

function variableKeyOf(parsed: ParsedTarget): string {
  return [parsed.source, parsed.variable].filter(Boolean).join(" / ");
}

function splitBreakdown(breakdown: string): string[] {
  const raw = breakdown ? breakdown.split(" · ").filter(Boolean) : [];
  const out: string[] = [];
  for (const token of raw) {
    if (FILING_MODIFIERS.has(token) && out.length) {
      out[out.length - 1] = `${out[out.length - 1]} · ${token}`;
    } else {
      out.push(token);
    }
  }
  return out;
}

function classifyDimension(values: string[]): string {
  const v = values.filter(Boolean);
  if (!v.length) return "Breakdown";
  const all = (pred: (s: string) => boolean) => v.every(pred);
  const firstStatus = (s: string) => s.split(" · ")[0];
  if (all((s) => s.startsWith("AGI in "))) return "Income band";
  if (all((s) => RETURN_TYPES.has(s))) return "Return type";
  if (all((s) => FILING_STATUSES.has(firstStatus(s)))) return "Filing status";
  if (all((s) => QUALIFYING_CHILDREN.has(s))) return "Qualifying children";
  if (all((s) => /^\d+$/.test(s))) return "Age";
  if (all((s) => MEASURES.has(s))) return "Measure";
  return "Breakdown";
}

function parseAmount(token: string): number {
  const normalized = token.trim().toLowerCase().replace(/,/g, "");
  if (/^-?inf(?:inity)?$/.test(normalized)) return normalized.startsWith("-") ? -Infinity : Infinity;
  const negative = normalized.startsWith("-");
  const magnitude = parseFloat(normalized);
  if (!Number.isFinite(magnitude)) return 0;
  const mult = /k$/.test(normalized) ? 1e3 : /m$/.test(normalized) ? 1e6 : 1;
  return (negative ? -1 : 1) * Math.abs(magnitude) * mult;
}

function totalDimensionRank(value: string): number {
  return /^(all|total|all returns)$/i.test(value.trim()) ? 0 : 1;
}

function numericRange(value: string): { lower: number; upper: number } | null {
  const body = value
    .replace(/^AGI in\s+/i, "")
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, " ");
  const amount = "-?\\d+(?:\\.\\d+)?[km]?";

  let match = new RegExp(`^under (${amount})$`).exec(body);
  if (match) return { lower: -Infinity, upper: parseAmount(match[1]) };

  match = new RegExp(`^(${amount}) plus$`).exec(body);
  if (match) return { lower: parseAmount(match[1]), upper: Infinity };

  match = new RegExp(`^(${amount}) to (${amount})$`).exec(body);
  if (match) return { lower: parseAmount(match[1]), upper: parseAmount(match[2]) };

  match = new RegExp(`^(${amount})-(${amount}|inf|infinity)$`).exec(body);
  if (match) return { lower: parseAmount(match[1]), upper: parseAmount(match[2]) };

  match = new RegExp(`^(${amount})$`).exec(body);
  if (match) {
    const point = parseAmount(match[1]);
    return { lower: point, upper: point };
  }

  return null;
}

function compareNumericRangesDescending(a: string, b: string): number {
  const totalRank = totalDimensionRank(a) - totalDimensionRank(b);
  if (totalRank !== 0) return totalRank;

  const ar = numericRange(a);
  const br = numericRange(b);
  if (ar || br) {
    if (!ar) return 1;
    if (!br) return -1;
    return br.lower - ar.lower || br.upper - ar.upper || a.localeCompare(b);
  }

  return a.localeCompare(b);
}

function sortDimensionValues(label: string, values: string[]): string[] {
  if (label === "Income band") return [...values].sort(compareNumericRangesDescending);
  if (label === "Age") return [...values].sort(compareNumericRangesDescending);
  if (label === "Qualifying children") {
    const rank = (value: string) =>
      [
        "all qualifying children",
        "three or more qualifying children",
        "two qualifying children",
        "one qualifying child",
        "no qualifying children",
      ].indexOf(value);
    return [...values].sort((a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar >= 0 || br >= 0) return (ar >= 0 ? ar : 99) - (br >= 0 ? br : 99);
      return compareNumericRangesDescending(a, b);
    });
  }
  return [...values].sort(compareNumericRangesDescending);
}

function rowFacetValue(row: TargetRow, key: string): string | undefined {
  if (key === "geography") return (row.geography as string) || undefined;
  if (key === "level") return (row.level as string) || undefined;
  const targetDimensions = row.target_dimensions as TargetBreakdownDimension[] | undefined;
  const targetDimension = targetDimensions?.find((dim) => dim.key === key);
  if (targetDimension) return targetDimension.value;
  const dim = /^dim(\d+)$/.exec(key);
  if (dim) return (row.dims as string[] | undefined)?.[Number(dim[1])];
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function sortFacetValues(label: string, values: string[]): string[] {
  if (label === "Geography") {
    return [...values].sort((a, b) =>
      a === "United States" ? -1 : b === "United States" ? 1 : a.localeCompare(b),
    );
  }
  return sortDimensionValues(label, values);
}

export interface TargetDimension {
  key: string;
  label: string;
  values: string[];
}

function computeDimensions(rows: TargetRow[]): TargetDimension[] {
  const candidates: { key: string; label?: string }[] = [
    { key: "geography", label: "Geography" },
  ];
  const seenDimensionKeys = new Set<string>();
  for (const row of rows) {
    const targetDimensions = row.target_dimensions as TargetBreakdownDimension[] | undefined;
    for (const dim of targetDimensions ?? []) {
      if (seenDimensionKeys.has(dim.key)) continue;
      seenDimensionKeys.add(dim.key);
      candidates.push({ key: dim.key, label: dim.label });
    }
  }
  const facets: TargetDimension[] = [];
  for (const candidate of candidates) {
    const values = [
      ...new Set(
        rows.map((row) => rowFacetValue(row, candidate.key)).filter((v): v is string => Boolean(v)),
      ),
    ];
    if (values.length <= 1) continue;
    const label = candidate.label ?? classifyDimension(values);
    facets.push({ key: candidate.key, label, values: sortFacetValues(label, values) });
  }
  return facets;
}

function deriveFamily(name: string): string {
  const parts = name.split("/");
  if (parts.length < 2) return name;
  const [geo, second] = parts;
  if (/^[A-Z]{2}$/.test(second)) return "state_distribution";
  if (/^US\d{2}$/.test(geo)) return second;
  return `${geo}/${second}`;
}

function deriveState(name: string): string | null {
  const parts = name.split("/");
  return parts.length >= 2 && /^[A-Z]{2}$/.test(parts[1]) ? parts[1] : null;
}

function skippedTargetReasons(skipped: unknown[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const entry of skipped) {
    if (typeof entry === "string") {
      reasons.set(entry, "Skipped by calibration.");
      continue;
    }
    const row = asObject(entry);
    const name = stringValue(row.name) ?? stringValue(row.target_name);
    if (!name) continue;
    reasons.set(name, stringValue(row.reason) ?? "Skipped by calibration.");
  }
  return reasons;
}

function targetNames(row: TargetRow, fullName: string, baseName: string): string[] {
  const names = [
    fullName,
    baseName,
    stringValue(row.name),
    stringValue(row.target_name),
    stringValue(asObject(row.metadata).ledger_source_record_id),
  ];
  return [...new Set(names.filter((name): name is string => Boolean(name)))];
}

function calibrationStatus(
  row: TargetRow,
  names: string[],
  skippedByName: Map<string, string>,
  droppedTargetNames: Set<string>,
): {
  calibration_status: "included" | "skipped" | "not_materialized";
  calibration_status_label: string;
  calibration_status_reason: string | null;
} {
  const skippedName = names.find((name) => skippedByName.has(name));
  if (skippedName) {
    return {
      calibration_status: "skipped",
      calibration_status_label: "Skipped",
      calibration_status_reason: skippedByName.get(skippedName) ?? "Skipped by calibration.",
    };
  }
  const droppedName = names.find((name) => droppedTargetNames.has(name));
  if (droppedName) {
    return {
      calibration_status: "not_materialized",
      calibration_status_label: "Not materialized",
      calibration_status_reason: "The target was declared but no model column/filter was materialized for it.",
    };
  }
  if (numberOrNull(row.initial_estimate) == null && numberOrNull(row.final_estimate) == null) {
    return {
      calibration_status: "not_materialized",
      calibration_status_label: "No estimate",
      calibration_status_reason: "The diagnostics row has no initial or final estimate.",
    };
  }
  return {
    calibration_status: "included",
    calibration_status_label: "Included",
    calibration_status_reason: null,
  };
}

// Enrich a raw target row. Schema v2 publishes the canonical registry fields
// (source citation, entity, aggregation, measure, period, target_name); we keep
// the parsed geography/source/variable/breakdown for navigation and surface the
// published metadata alongside. v1 rows simply lack those extra fields.
function enrichTargetRow(
  row: TargetRow,
  skippedByName: Map<string, string> = new Map(),
  droppedTargetNames: Set<string> = new Set(),
): TargetRow {
  const fullName = String(row.name ?? "");
  // v2 carries target_name (no @period); else strip any @period from the name.
  const baseName = String(row.target_name ?? fullName.split("@")[0]);
  const status = calibrationStatus(
    row,
    targetNames(row, fullName, baseName),
    skippedByName,
    droppedTargetNames,
  );
  const target = numberOrNull(row.target);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  const errorKind = target === 0 ? "absolute" : "relative";
  const rawFinalError = numberOrNull(row.relative_error) ?? relativeError(final, target);
  const rawInitialError = relativeError(initial, target);
  const initialMiss = initial != null && target != null ? initial - target : null;
  const finalMiss = final != null && target != null ? final - target : null;
  const absInitialMiss = initialMiss == null ? null : Math.abs(initialMiss);
  const absFinalMiss = finalMiss == null ? null : Math.abs(finalMiss);
  const absoluteImprovement =
    absInitialMiss == null || absFinalMiss == null
      ? null
      : absInitialMiss - absFinalMiss;
  const initialError =
    errorKind === "absolute" && initial != null && target != null
      ? initialMiss
      : rawInitialError;
  const finalError =
    errorKind === "absolute" && final != null && target != null
      ? finalMiss
      : rawFinalError;
  const absFinalError = finalError == null ? null : Math.abs(finalError);
  const improvement =
    initialError == null || finalError == null
      ? null
      : Math.abs(initialError) - Math.abs(finalError);
  const parsed = parseDottedTarget(baseName, row) ?? parseTarget(baseName);
  const measureCol = asObject(row.measure);
  const metadata = asObject(row.metadata);
  const metadataTargetDimensions = metadataDimensions(row);
  const targetDimensions =
    metadataTargetDimensions ??
    splitBreakdown(parsed.breakdown).map((value, index) => ({
      key: `dim${index}`,
      label: classifyDimension([value]),
      value,
    }));
  const dims = targetDimensions.map((dim) => dim.value);
  const breakdown = metadataTargetDimensions ? dims.join(" · ") : parsed.breakdown;
  const sourceMeasureId = stringValue(metadata.source_measure_id);
  const targetRole = stringValue(metadata.target_role);
  const policyengineVariables = policyengineVariablesFromMetadata(metadata);
  // The first breakdown token is the measure (total / count / mean / …). Many
  // IRS variables publish both a total (dollar amount) and a count (number of
  // returns), so the measure is part of the variable's identity, not a
  // breakdown within it — fold it into variable_key so they're distinct things.
  const measure = dims[0] && MEASURES.has(dims[0])
    ? dims[0]
    : measureFromMetadata(metadata);
  const variableKey =
    variableKeyOf(parsed) + (measure ? ` · ${measure}` : "");
  return {
    ...row,
    name: fullName,
    base_name: baseName,
    family: deriveFamily(baseName),
    state: stateFromGeoId(stringValue(metadata.ledger_geography_id)) ?? deriveState(baseName),
    geography: parsed.geography,
    level: parsed.level,
    source: parsed.source,
    variable: parsed.variable,
    measure,
    target_role: targetRole,
    source_measure_id: sourceMeasureId,
    policyengine_variables: policyengineVariables.length
      ? policyengineVariables
      : fallbackPolicyengineVariables(metadata),
    policyengine_map_to: stringValue(metadata.count_map_to) ?? fallbackPolicyengineMapTo(metadata),
    policyengine_filter_variable: stringValue(metadata.count_filter_variable) ?? fallbackPolicyengineFilterVariable(metadata),
    materializer: stringValue(metadata.materializer),
    measure_mode: stringValue(metadata.measure_mode) ?? fallbackMeasureMode(metadata),
    error_kind: errorKind,
    initial_error: initialError,
    final_error: finalError,
    initial_miss: initialMiss,
    final_miss: finalMiss,
    abs_final_miss: absFinalMiss,
    absolute_improvement: absoluteImprovement,
    abs_error: absFinalError,
    breakdown,
    dims,
    target_dimensions: targetDimensions,
    variable_key: variableKey,
    // v2 published metadata (null on v1).
    source_citation: typeof row.source === "string" ? (row.source as string) : null,
    entity: typeof row.entity === "string" ? (row.entity as string) : null,
    aggregation: typeof row.aggregation === "string" ? (row.aggregation as string) : null,
    measure_name: typeof measureCol.name === "string" ? (measureCol.name as string) : null,
    period: numberOrNull(row.period),
    ledger: ledgerFactFields(metadata),
    initial_relative_error: errorKind === "relative" ? initialError : null,
    abs_relative_error: errorKind === "relative" ? absFinalError : null,
    improvement,
    direction: finalError == null ? null : finalError > 0 ? "over" : finalError < 0 ? "under" : "exact",
    ...status,
  };
}

function estimateScopeKey(row: TargetRow): string | null {
  if (row.filter != null) return null;
  const metadata = asObject(row.metadata);
  const recordSet = stringValue(metadata.ledger_layout_record_set_id);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  if (!recordSet || initial == null || final == null) return null;
  return [
    row.source,
    row.period,
    metadata.ledger_geography_id,
    metadata.ledger_layout_groupby_dimension,
    metadata.ledger_layout_groupby_value_id,
    metadata.ledger_layout_measure_id,
    metadata.source_measure_id,
    metadata.variable,
    initial,
    final,
  ].join("||");
}

function estimateScopeWarning(row: TargetRow): string {
  const metadata = asObject(row.metadata);
  const childGroup = qualifyingChildrenFromRecordSet(
    stringValue(metadata.ledger_layout_record_set_id),
  );
  if (childGroup) {
    return "This Ledger fact is for a qualifying-children slice, but the calibration diagnostics did not include a compiled model filter for that child-count slice. The estimate may reflect the broader EITC aggregate instead of this exact slice.";
  }
  return "This Ledger fact is one slice of a target family, but the calibration diagnostics did not include a compiled model filter for this slice and sibling slices share the same estimate. The estimate may reflect a broader aggregate than this exact fact.";
}

function addEstimateScopeWarnings(rows: TargetRow[]): TargetRow[] {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const key = estimateScopeKey(row);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }

  const flagged = new Set<TargetRow>();
  for (const group of groups.values()) {
    const recordSets = new Set(
      group
        .map((row) => stringValue(asObject(row.metadata).ledger_layout_record_set_id))
        .filter((value): value is string => Boolean(value)),
    );
    const targets = new Set(group.map((row) => numberOrNull(row.target)));
    if (recordSets.size <= 1 || targets.size <= 1) continue;
    for (const row of group) flagged.add(row);
  }

  if (!flagged.size) return rows;
  return rows.map((row) =>
    flagged.has(row)
      ? {
          ...row,
          estimate_warning: estimateScopeWarning(row),
        }
      : row,
  );
}

function stringParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitVariableList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap(splitVariableList)
      .filter((variable, index, all) => all.indexOf(variable) === index);
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((variable) => variable.trim())
    .filter(Boolean);
}

function policyengineVariablesFromMetadata(metadata: JsonObject): string[] {
  const variables = [
    ...splitVariableList(metadata.base_variables),
    ...splitVariableList(metadata.base_variable),
  ];
  return variables.filter((variable, index) => variables.indexOf(variable) === index);
}

function fallbackPolicyengineVariables(metadata: JsonObject): string[] {
  const targetRole = stringValue(metadata.target_role);
  const sourceMeasureId = stringValue(metadata.source_measure_id);
  if (
    targetRole === "aca_spending" ||
    targetRole === "aca_ptc_recipients" ||
    sourceMeasureId === "premium_tax_credit_amount" ||
    sourceMeasureId === "premium_tax_credit_returns"
  ) {
    return ["assigned_aca_ptc"];
  }
  if (targetRole === "aca_enrollment") {
    return ["has_marketplace_health_coverage_at_interview"];
  }
  if (targetRole === "medicaid_spending") {
    return ["medicaid"];
  }
  if (targetRole === "medicaid_enrollment") {
    return ["medicaid_enrolled"];
  }
  if (targetRole === "medicaid_chip_enrollment") {
    return ["medicaid_enrolled", "chip_enrolled"];
  }
  if (targetRole === "medicare_part_b_premium_total") {
    return ["gross_medicare_part_b_premium"];
  }
  return [];
}

function fallbackPolicyengineMapTo(metadata: JsonObject): string | null {
  return stringValue(metadata.target_role) === "aca_ptc_recipients" ? "person" : null;
}

function fallbackPolicyengineFilterVariable(metadata: JsonObject): string | null {
  return stringValue(metadata.target_role) === "aca_ptc_recipients"
    ? "is_aca_ptc_eligible"
    : null;
}

function fallbackMeasureMode(metadata: JsonObject): string | null {
  const targetRole = stringValue(metadata.target_role);
  if (
    targetRole === "aca_enrollment" ||
    targetRole === "aca_ptc_recipients" ||
    targetRole === "medicaid_enrollment" ||
    targetRole === "medicaid_chip_enrollment"
  ) {
    return "positive_count";
  }
  if (
    targetRole === "aca_spending" ||
    targetRole === "medicaid_spending" ||
    targetRole === "medicare_part_b_premium_total"
  ) {
    return "sum";
  }
  return null;
}

function booleanParam(value: string | null): boolean | null {
  if (value == null || value === "") return null;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  return null;
}

function matchesSearch(row: TargetRow, search: string): boolean {
  const haystack = [
    row.name, row.variable, row.source, row.breakdown, row.geography, row.state,
    row.source_citation,
  ]
    .filter((v) => v != null)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

const HEALTHCARE_TARGET_ROLES = new Set([
  "aca_spending",
  "aca_enrollment",
  "aca_ptc_recipients",
  "aca_bronze_aptc_consumers",
  "medicaid_spending",
  "medicaid_enrollment",
  "medicaid_chip_enrollment",
  "medicare_part_b_premium_total",
]);

function isHealthcareTarget(row: TargetRow): boolean {
  const metadata = asObject(row.metadata);
  const targetRole = stringValue(metadata.target_role);
  if (targetRole && HEALTHCARE_TARGET_ROLES.has(targetRole)) return true;

  const haystack = [
    row.name,
    row.family,
    row.source,
    row.variable,
    row.variable_key,
    metadata.source_measure_id,
    metadata.ledger_measure_concept,
    metadata.ledger_domain,
  ]
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("cms_aca") ||
    haystack.includes("cms_medicaid") ||
    haystack.includes("cms_medicare") ||
    haystack.includes("medicaid") ||
    haystack.includes("chip") ||
    haystack.includes("medicare") ||
    haystack.includes("premium tax credit") ||
    haystack.includes("aca_ptc")
  );
}

function withinToleranceCount(rows: TargetRow[]): number {
  return rows.filter((row) => row.within_tolerance === true).length;
}

export function populaceTargetFamilies(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.family ?? "")))].sort();
}

export function populaceTargetSources(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.source ?? "")))].filter(Boolean).sort();
}

export function populaceTargetLevels(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.level ?? "")))].filter(Boolean).sort();
}

export function populaceTargetGeographies(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.geography ?? "")))]
    .filter(Boolean)
    .sort((a, b) =>
      a === "United States" ? -1 : b === "United States" ? 1 : a.localeCompare(b),
    );
}

export function populaceVariableSummary(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const key = String(row.variable_key ?? "");
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  return [...groups.entries()]
    .map(([variable_key, group]) => {
      const first = group[0];
      const absErrors = group
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((v): v is number => v != null);
      const policyengineVariables = [
        ...new Set(
          group.flatMap((row) =>
            Array.isArray(row.policyengine_variables)
              ? row.policyengine_variables.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
          ),
        ),
      ];
      const uniqueString = (key: string) => {
        const values = [
          ...new Set(
            group
              .map((row) => row[key])
              .filter(
                (value): value is string =>
                  typeof value === "string" && value.length > 0,
              ),
          ),
        ];
        return values.length === 1 ? values[0] : null;
      };
      return {
        variable_key,
        source: String(first.source ?? ""),
        variable: String(first.variable ?? ""),
        measure: first.measure ? String(first.measure) : null,
        level: String(first.level ?? ""),
        policyengine_variables: policyengineVariables,
        policyengine_map_to: uniqueString("policyengine_map_to"),
        policyengine_filter_variable: uniqueString("policyengine_filter_variable"),
        materializer: uniqueString("materializer"),
        measure_mode: uniqueString("measure_mode"),
        n_targets: group.length,
        within_10pct: group.filter((r) => (numberOrNull(r.abs_relative_error) ?? Infinity) <= 0.1).length,
        within_tolerance: group.filter((r) => r.within_tolerance === true).length,
        mean_abs_relative_error: absErrors.length
          ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length
          : null,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);
}

function familyFitSummary(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const family = String(row.family ?? "");
    (groups.get(family) ?? groups.set(family, []).get(family)!).push(row);
  }
  return [...groups.entries()]
    .map(([family, group]) => {
      const absErrors = group
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((v): v is number => v != null);
      return {
        family,
        n_targets: group.length,
        within_tolerance: withinToleranceCount(group),
        within_10pct: group.filter((r) => (numberOrNull(r.abs_relative_error) ?? Infinity) <= 0.1).length,
        mean_abs_relative_error: absErrors.length ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length : null,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);
}

// --- calibration map (treemap) ----------------------------------------------
// Human labels for the source authorities behind each target group.
const SOURCE_LABELS: Record<string, string> = {
  cbo: "CBO",
  census_population: "Census population",
  cms_aca: "CMS · ACA marketplace",
  cms_medicaid: "CMS · Medicaid / CHIP",
  cms_medicare: "CMS · Medicare",
  hhs_acf_tanf: "HHS · TANF",
  irs_soi: "IRS Statistics of Income",
  jct: "JCT",
  ssa: "SSA",
  state_income_tax: "State income tax",
  usda_snap: "USDA · SNAP",
};

function sourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  return source
    .split("_")
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

// A few IRS targets sit near zero and blow up the relative error (the same
// "extreme outliers" the diagnostics lists exclude). Winsorize the per-target
// error before squaring so the loss map shows where error broadly concentrates
// rather than which single target is the most pathological, and color by the
// median so one outlier can't paint a whole group red.
const LOSS_ERROR_CAP = 2.0; // 200%

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TreemapLeaf {
  key: string;
  source: string;
  variable: string;
  measure: string | null;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
}

export interface TreemapGroup {
  source: string;
  label: string;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
  children: TreemapLeaf[];
}

export interface TreemapData {
  release_id: string;
  total_targets: number;
  total_within_10pct: number;
  total_scored: number;
  total_loss: number;
  groups: TreemapGroup[];
}

// Build the source → variable hierarchy that powers the calibration map.
// Each leaf carries both "how much we calibrate to it" (n_targets) and "how
// much of the calibration loss lands here" (loss = sum of squared relative
// errors, the per-target term of the normalized target loss). Targets with no
// relative error (absolute targets where the target value is zero) still count
// toward n_targets but contribute nothing to loss or fit.
export function populaceTargetTreemap(rows: TargetRow[], releaseId: string): TreemapData {
  const groups = new Map<string, Map<string, TargetRow[]>>();
  for (const row of rows) {
    const source = String(row.source ?? "").trim() || "other";
    const key = String(row.variable_key ?? row.variable ?? "—");
    const byVar = groups.get(source) ?? groups.set(source, new Map()).get(source)!;
    (byVar.get(key) ?? byVar.set(key, []).get(key)!).push(row);
  }

  const leafOf = (source: string, key: string, group: TargetRow[]): TreemapLeaf => {
    const absErrors = group
      .map((row) => numberOrNull(row.abs_relative_error))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const first = group[0];
    return {
      key,
      source,
      variable: String(first.variable ?? key),
      measure: first.measure ? String(first.measure) : null,
      n_targets: group.length,
      scored: absErrors.length,
      within_10pct: absErrors.filter((v) => v <= 0.1).length,
      loss: absErrors.reduce((sum, v) => {
        const capped = Math.min(v, LOSS_ERROR_CAP);
        return sum + capped * capped;
      }, 0),
      mean_abs_relative_error: absErrors.length
        ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length
        : null,
      median_abs_relative_error: median(absErrors),
    };
  };

  const groupList: TreemapGroup[] = [...groups.entries()]
    .map(([source, byVar]) => {
      const children = [...byVar.entries()]
        .map(([key, group]) => leafOf(source, key, group))
        .sort((a, b) => b.n_targets - a.n_targets);
      const allErrors = [...byVar.values()]
        .flat()
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((v): v is number => v != null && Number.isFinite(v));
      const n_targets = children.reduce((s, c) => s + c.n_targets, 0);
      const scored = children.reduce((s, c) => s + c.scored, 0);
      const within_10pct = children.reduce((s, c) => s + c.within_10pct, 0);
      const loss = children.reduce((s, c) => s + c.loss, 0);
      return {
        source,
        label: sourceLabel(source),
        n_targets,
        scored,
        within_10pct,
        loss,
        mean_abs_relative_error: allErrors.length
          ? allErrors.reduce((s, v) => s + v, 0) / allErrors.length
          : null,
        median_abs_relative_error: median(allErrors),
        children,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);

  return {
    release_id: releaseId,
    total_targets: groupList.reduce((s, g) => s + g.n_targets, 0),
    total_within_10pct: groupList.reduce((s, g) => s + g.within_10pct, 0),
    total_scored: groupList.reduce((s, g) => s + g.scored, 0),
    total_loss: groupList.reduce((s, g) => s + g.loss, 0),
    groups: groupList,
  };
}

// --- the calibration source (one release) -----------------------------------
export interface Calibration {
  source: "huggingface_live";
  release_id: string;
  updated_at: string | null;
  schema_version: unknown;
  weight_entity: unknown;
  options: JsonObject;
  l0_lambda: number | null;
  n_nonzero: number | null;
  n_records: number | null;
  initial_loss: number | null;
  final_loss: number | null;
  loss_kind: CalibrationLossKind;
  fraction_within_10pct: number | null;
  loss_trajectory: number[];
  skipped: unknown[];
  declared_targets: number | null;
  compiled_candidate_targets: number | null;
  dropped_target_names: string[];
  included_target_count: number;
  build_manifest: JsonObject;
  release_manifest: JsonObject;
  rows: TargetRow[];
}

interface ReleaseCacheEntry {
  expiresAt: number;
  promise: Promise<Calibration>;
}

interface TargetDiagnosticsMetadata {
  sources: string[];
  levels: string[];
  geographies: string[];
  variables: ReturnType<typeof populaceVariableSummary>;
}

interface InvestigationSignal {
  tone: "critical" | "warning" | "neutral" | "positive";
  label: string;
  detail: string;
}

interface InvestigationSearch {
  label: string;
  query: string;
  url: string;
}

const releaseCache = new Map<string, ReleaseCacheEntry>();
const targetDiagnosticsMetadataCache = new WeakMap<TargetRow[], TargetDiagnosticsMetadata>();

export function buildCalibration(
  diag: JsonObject,
  releaseId: string,
  updatedAt: string | null = null,
  buildManifest: JsonObject = {},
  releaseManifest: JsonObject = {},
): Calibration {
  const targets = Array.isArray(diag.targets) ? (diag.targets as TargetRow[]) : [];
  const skipped = Array.isArray(diag.skipped) ? (diag.skipped as JsonObject[]) : [];
  const targetCompilation = asObject(asObject(buildManifest.gates).target_compilation);
  const droppedTargetNames = Array.isArray(targetCompilation.dropped_target_names)
    ? targetCompilation.dropped_target_names
        .map((value) => (typeof value === "string" ? value : null))
        .filter((value): value is string => value != null)
    : [];
  const skippedByName = skippedTargetReasons(skipped);
  const dropped = new Set(droppedTargetNames);
  const rows = addEstimateScopeWarnings(
    targets.map((row) => enrichTargetRow(row, skippedByName, dropped)),
  );
  const includedTargetCount = rows.filter((row) => row.calibration_status === "included").length;
  return {
    source: "huggingface_live",
    release_id: String(diag.release_id ?? releaseId),
    updated_at: updatedAt,
    schema_version: diag.schema_version ?? null,
    weight_entity: diag.weight_entity ?? null,
    options: asObject(diag.options),
    l0_lambda: numberOrNull(diag.l0_lambda),
    n_nonzero: numberOrNull(diag.n_nonzero),
    n_records: numberOrNull(diag.n_records),
    initial_loss: numberOrNull(diag.initial_loss),
    final_loss: numberOrNull(diag.final_loss),
    loss_kind: calibrationLossKind(diag, buildManifest),
    fraction_within_10pct: numberOrNull(diag.fraction_within_10pct),
    loss_trajectory: Array.isArray(diag.loss_trajectory) ? (diag.loss_trajectory as number[]) : [],
    skipped,
    declared_targets: numberOrNull(targetCompilation.declared_targets),
    compiled_candidate_targets: numberOrNull(targetCompilation.compiled_candidate_targets),
    dropped_target_names: droppedTargetNames,
    included_target_count: includedTargetCount,
    build_manifest: buildManifest,
    release_manifest: releaseManifest,
    rows,
  };
}

// --- HF access --------------------------------------------------------------
export function hfResolveUrl(path: string, country: PopulaceCountry = "us"): string {
  const { repo, revision } = COUNTRY_REPO[country];
  return `https://huggingface.co/datasets/${repo}/resolve/${revision}/${path}`;
}

async function hfJson(url: string, revalidate: number): Promise<JsonObject> {
  const res = await fetch(url, { next: { revalidate }, headers: hfAuthHeaders() });
  if (!res.ok) throw new Error(`HF fetch failed ${res.status}: ${url}`);
  return asObject(await res.json());
}

export interface ReleaseEntry {
  release_id: string;
  date: string;
  files: string[];
  has_calibration: boolean;
}

// Trailing timestamp/date in a build id, for newest-first ordering.
function releaseDate(id: string): string {
  const m = /(\d{8}(?:T\d{6}Z)?)$/.exec(id);
  return m ? m[1] : id;
}

export async function loadReleases(
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<ReleaseEntry[]> {
  const { repo, revision } = COUNTRY_REPO[country];
  const url = `https://huggingface.co/api/datasets/${repo}/tree/${revision}/releases?recursive=true`;
  const res = await fetch(url, { next: { revalidate }, headers: hfAuthHeaders() });
  if (!res.ok) throw new Error(`HF tree failed ${res.status}`);
  const tree = await res.json();
  const files = new Map<string, Set<string>>();
  if (Array.isArray(tree)) {
    for (const entry of tree) {
      const item = asObject(entry);
      if (item.type !== "file" || typeof item.path !== "string") continue;
      const match = item.path.match(/^releases\/([^/]+)\/(.+)$/);
      if (!match) continue;
      (files.get(match[1]) ?? files.set(match[1], new Set()).get(match[1])!).add(match[2]);
    }
  }
  return [...files.entries()]
    .map(([release_id, set]) => ({
      release_id,
      date: releaseDate(release_id),
      files: [...set].sort(),
      has_calibration: set.has("calibration_diagnostics.json"),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function loadPointerReleaseId(
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<{ release_id: string; updated_at: string | null }> {
  const pointer = await hfJson(hfResolveUrl("latest.json", country), revalidate);
  return {
    release_id: String(pointer.release_id ?? ""),
    updated_at: typeof pointer.updated_at === "string" ? pointer.updated_at : null,
  };
}

// Load one release's manifests + calibration diagnostics. releaseId "latest"
// resolves through the pointer.
export async function loadRelease(
  releaseId: string,
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<Calibration> {
  const cacheKey = `${country}:${releaseId || "latest"}:${revalidate}`;
  const now = Date.now();
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = loadReleaseUncached(releaseId, revalidate, country);
  releaseCache.set(cacheKey, {
    promise,
    expiresAt: now + Math.max(revalidate, 1) * 1000,
  });
  try {
    return await promise;
  } catch (error) {
    releaseCache.delete(cacheKey);
    throw error;
  }
}

async function loadReleaseUncached(
  releaseId: string,
  revalidate: number,
  country: PopulaceCountry,
): Promise<Calibration> {
  let id = releaseId;
  let updatedAt: string | null = null;
  if (releaseId === "latest" || !releaseId) {
    const ptr = await loadPointerReleaseId(revalidate, country);
    id = ptr.release_id;
    updatedAt = ptr.updated_at;
  }
  const prefix = `releases/${id}`;
  const [diag, buildManifest, releaseManifest] = await Promise.all([
    hfJson(hfResolveUrl(`${prefix}/calibration_diagnostics.json`, country), revalidate),
    hfJson(hfResolveUrl(`${prefix}/build_manifest.json`, country), revalidate).catch(() => ({})),
    hfJson(hfResolveUrl(`${prefix}/release_manifest.json`, country), revalidate).catch(() => ({})),
  ]);
  return buildCalibration(diag, id, updatedAt, buildManifest, releaseManifest);
}

function targetDiagnosticsMetadata(rows: TargetRow[]): TargetDiagnosticsMetadata {
  const cached = targetDiagnosticsMetadataCache.get(rows);
  if (cached) return cached;
  const metadata = {
    sources: populaceTargetSources(rows),
    levels: populaceTargetLevels(rows),
    geographies: populaceTargetGeographies(rows),
    variables: populaceVariableSummary(rows),
  };
  targetDiagnosticsMetadataCache.set(rows, metadata);
  return metadata;
}

function targetResponseRow(row: TargetRow): TargetRow {
  return {
    name: row.name,
    target: row.target,
    initial_estimate: row.initial_estimate,
    final_estimate: row.final_estimate,
    relative_error: row.relative_error,
    within_tolerance: row.within_tolerance,
    base_name: row.base_name,
    family: row.family,
    state: row.state,
    geography: row.geography,
    level: row.level,
    source: row.source,
    variable: row.variable,
    measure: row.measure,
    target_role: row.target_role,
    source_measure_id: row.source_measure_id,
    policyengine_variables: row.policyengine_variables,
    policyengine_map_to: row.policyengine_map_to,
    policyengine_filter_variable: row.policyengine_filter_variable,
    materializer: row.materializer,
    measure_mode: row.measure_mode,
    error_kind: row.error_kind,
    initial_error: row.initial_error,
    final_error: row.final_error,
    initial_miss: row.initial_miss,
    final_miss: row.final_miss,
    abs_final_miss: row.abs_final_miss,
    absolute_improvement: row.absolute_improvement,
    abs_error: row.abs_error,
    breakdown: row.breakdown,
    dims: row.dims,
    target_dimensions: row.target_dimensions,
    variable_key: row.variable_key,
    source_citation: row.source_citation,
    entity: row.entity,
    aggregation: row.aggregation,
    measure_name: row.measure_name,
    period: row.period,
    ledger: row.ledger,
    estimate_warning: row.estimate_warning,
    calibration_status: row.calibration_status,
    calibration_status_label: row.calibration_status_label,
    calibration_status_reason: row.calibration_status_reason,
    initial_relative_error: row.initial_relative_error,
    abs_relative_error: row.abs_relative_error,
    improvement: row.improvement,
    direction: row.direction,
  };
}

function githubSearchUrl(query: string): string {
  const scoped = `org:PolicyEngine ${query}`;
  return `https://github.com/search?type=code&q=${encodeURIComponent(scoped)}`;
}

function investigationSearches(row: TargetRow): InvestigationSearch[] {
  const ledger = asObject(row.ledger);
  const metadata = asObject(row.metadata);
  const terms: [string, string | null][] = [
    ["Source record", stringValue(ledger.source_record_id)],
    ["Fact key", stringValue(ledger.fact_key)],
    ["Semantic fact", stringValue(ledger.semantic_fact_key)],
    ["Aggregate fact", stringValue(ledger.aggregate_fact_key)],
    ["Legacy fact", stringValue(ledger.legacy_fact_key)],
    ["Record set", stringValue(ledger.layout_record_set_id)],
    ["Measure concept", stringValue(ledger.measure_concept)],
    ["Source concept", stringValue(ledger.source_concept)],
    ["Source measure", stringValue(metadata.source_measure_id)],
    ["Variable", stringValue(metadata.variable) ?? stringValue(row.variable)],
  ];
  const seen = new Set<string>();
  const nonEmptyTerms: [string, string][] = [];
  for (const [label, value] of terms) {
    if (!value) continue;
    nonEmptyTerms.push([label, value]);
  }
  return nonEmptyTerms
    .filter(([, value]) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map(([label, value]) => ({
      label,
      query: `"${value}"`,
      url: githubSearchUrl(`"${value}"`),
    }));
}

function investigationSignals(row: TargetRow): InvestigationSignal[] {
  const signals: InvestigationSignal[] = [];
  const target = numberOrNull(row.target);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  const initialMiss = numberOrNull(row.initial_miss);
  const finalMiss = numberOrNull(row.final_miss);
  const absRel = numberOrNull(row.abs_relative_error);
  const improvement = numberOrNull(row.improvement);
  const absoluteImprovement = numberOrNull(row.absolute_improvement);
  const calibrationStatus = stringValue(row.calibration_status);

  if (calibrationStatus && calibrationStatus !== "included") {
    signals.push({
      tone: "critical",
      label: "Target not included",
      detail: stringValue(row.calibration_status_reason) ?? "The target was not included in calibration.",
    });
  }
  if (stringValue(row.estimate_warning)) {
    signals.push({
      tone: "critical",
      label: "Estimate scope warning",
      detail: stringValue(row.estimate_warning)!,
    });
  }
  if (target === 0 && final != null && Math.abs(final) > 0) {
    signals.push({
      tone: "warning",
      label: "Zero target has non-zero estimate",
      detail: "The dashboard reports absolute miss instead of relative error because the target value is zero.",
    });
  }
  if (absRel != null) {
    const tone = absRel > 1 ? "critical" : absRel > 0.1 ? "warning" : "positive";
    signals.push({
      tone,
      label: "Final fit",
      detail:
        absRel <= 0.1
          ? "The final estimate is within 10% of the target."
          : `The final estimate is ${(absRel * 100).toFixed(absRel > 1 ? 1 : 2)}% away from the target.`,
    });
  }
  if (initialMiss != null && finalMiss != null) {
    const sameDirection = Math.sign(initialMiss) === Math.sign(finalMiss) && Math.sign(finalMiss) !== 0;
    if (sameDirection && improvement != null && improvement <= 0) {
      signals.push({
        tone: "warning",
        label: "Calibration moved away",
        detail: "Initial and final miss have the same sign, and the absolute error did not improve.",
      });
    } else if (sameDirection && absoluteImprovement != null && absoluteImprovement > 0) {
      signals.push({
        tone: absRel != null && absRel > 0.1 ? "warning" : "positive",
        label: "Same-side miss remains",
        detail: "Calibration reduced the miss, but the final estimate remains on the same side of the target.",
      });
    }
  }
  if (initial == null || final == null) {
    signals.push({
      tone: "critical",
      label: "Missing estimate",
      detail: "The published diagnostics do not contain both initial and final estimates for this target.",
    });
  }

  if (!signals.length) {
    signals.push({
      tone: "neutral",
      label: "No artifact-level warnings",
      detail: "The release artifact does not flag this target; investigate source target construction and model aggregate next.",
    });
  }
  return signals;
}

function investigationNextSteps(row: TargetRow): string[] {
  const steps = [
    "Verify the ledger fact: source period, target period, geography, unit, measure concept, and every filter/group-by value.",
    "Verify target materialization: confirm the Populus compiler creates a model selector for the exact ledger dimensions, not a broader aggregate.",
    "Verify model aggregate mapping: confirm the PolicyEngine variable or aggregate used for the estimate has the same unit, tax unit/person entity, sign convention, and period.",
    "Compare initial versus final miss: if both are badly off in the same direction, inspect source/model scope before tuning calibration weights.",
    "Inspect competing constraints for the same population slice if calibration improved one target while worsening another.",
  ];
  if (row.estimate_warning) {
    steps.unshift("Start with target materialization: the published diagnostics already indicate this estimate may be broader than the ledger slice.");
  }
  if (numberOrNull(row.target) === 0) {
    steps.unshift("Start with the ledger target value: confirm whether zero means a real zero, suppressed/missing source data, or a target intentionally dropped to zero.");
  }
  if (row.calibration_status !== "included") {
    steps.unshift("Start with the calibration status: the target was not included as an active calibration constraint.");
  }
  return [...new Set(steps)];
}

function targetInvestigationPacket(row: TargetRow, cal: Calibration) {
  const metadata = asObject(row.metadata);
  return {
    release_id: cal.release_id,
    target: targetResponseRow(row),
    source_artifact: {
      hf_repo: POPULACE_HF_REPO,
      hf_revision: POPULACE_HF_REVISION,
      calibration_diagnostics_path: `releases/${cal.release_id}/calibration_diagnostics.json`,
      build_manifest_path: `releases/${cal.release_id}/build_manifest.json`,
      release_manifest_path: `releases/${cal.release_id}/release_manifest.json`,
    },
    source_metadata: {
      source_measure_id: stringValue(metadata.source_measure_id),
      variable: stringValue(metadata.variable),
      source_period: stringValue(metadata.source_period),
      target_period: stringValue(metadata.target_period),
    },
    signals: investigationSignals(row),
    next_steps: investigationNextSteps(row),
    repo_searches: investigationSearches(row),
    limits: [
      "The dashboard can prove what is in the release artifacts and ledger metadata.",
      "It cannot prove the generated per-record model filter or expression unless Populus exports that compiler trace for the target.",
      "When the artifact warns about scope, treat the estimate as provisional until the Populus materialized target is inspected.",
    ],
  };
}

// --- shaped outputs ---------------------------------------------------------
export function latestPopulaceCalibrationSummary(cal: Calibration) {
  return {
    available: true,
    source: cal.source,
    release_id: cal.release_id,
    schema_version: cal.schema_version,
    weight_entity: cal.weight_entity,
    options: cal.options,
    l0_lambda: cal.l0_lambda,
    n_nonzero: cal.n_nonzero,
    n_records: cal.n_records,
    initial_loss: cal.initial_loss,
    final_loss: cal.final_loss,
    loss_kind: cal.loss_kind,
    fraction_within_10pct: cal.fraction_within_10pct,
    loss_trajectory: cal.loss_trajectory,
    skipped: cal.skipped,
    declared_targets: cal.declared_targets,
    compiled_candidate_targets: cal.compiled_candidate_targets,
    dropped_target_count: cal.dropped_target_names.length,
    included_target_count: cal.included_target_count,
    total_targets: cal.rows.length,
    within_tolerance_count: withinToleranceCount(cal.rows),
    family_fit: familyFitSummary(cal.rows),
  };
}

const EXTREME_RELATIVE_ERROR_THRESHOLD = 10; // 1000%; usually tiny-denominator artifacts.

function worstBoundedRelativeFit(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      return error != null && error <= EXTREME_RELATIVE_ERROR_THRESHOLD;
    })
    .sort((a, b) => (numberOrNull(b.abs_relative_error) ?? 0) - (numberOrNull(a.abs_relative_error) ?? 0))
    .slice(0, limit);
}

function extremeRelativeOutliers(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      return error != null && error > EXTREME_RELATIVE_ERROR_THRESHOLD;
    })
    .sort((a, b) => (numberOrNull(b.abs_relative_error) ?? 0) - (numberOrNull(a.abs_relative_error) ?? 0))
    .slice(0, limit);
}

function largestAbsoluteMisses(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => numberOrNull(row.abs_final_miss) != null)
    .sort((a, b) => (numberOrNull(b.abs_final_miss) ?? 0) - (numberOrNull(a.abs_final_miss) ?? 0))
    .slice(0, limit);
}

function biggestRelativeImprovements(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const improvement = numberOrNull(row.improvement);
      const initial = numberOrNull(row.initial_relative_error);
      const final = numberOrNull(row.abs_relative_error);
      return (
        improvement != null &&
        improvement > 0 &&
        initial != null &&
        final != null &&
        Math.abs(initial) <= EXTREME_RELATIVE_ERROR_THRESHOLD &&
        final <= EXTREME_RELATIVE_ERROR_THRESHOLD
      );
    })
    .sort((a, b) => (numberOrNull(b.improvement) ?? 0) - (numberOrNull(a.improvement) ?? 0))
    .slice(0, limit);
}

function biggestAbsoluteImprovements(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const improvement = numberOrNull(row.absolute_improvement);
      return improvement != null && improvement > 0;
    })
    .sort((a, b) => (numberOrNull(b.absolute_improvement) ?? 0) - (numberOrNull(a.absolute_improvement) ?? 0))
    .slice(0, limit);
}

export function latestPopulaceCalibrationHighlights(cal: Calibration, limit = 15) {
  const extremeOutliers = extremeRelativeOutliers(cal.rows, limit);
  return {
    worst_fit: worstBoundedRelativeFit(cal.rows, limit),
    biggest_improvements: biggestRelativeImprovements(cal.rows, limit),
    worst_bounded_relative_fit: worstBoundedRelativeFit(cal.rows, limit),
    extreme_relative_outliers: extremeOutliers,
    extreme_relative_outlier_count: cal.rows.filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      return error != null && error > EXTREME_RELATIVE_ERROR_THRESHOLD;
    }).length,
    largest_absolute_misses: largestAbsoluteMisses(cal.rows, limit),
    biggest_relative_improvements: biggestRelativeImprovements(cal.rows, limit),
    biggest_absolute_improvements: biggestAbsoluteImprovements(cal.rows, limit),
  };
}

export function latestPopulaceTargetDiagnosticsPage(requestUrl: string, cal: Calibration) {
  const rows = cal.rows;
  const url = new URL(requestUrl);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
  const includeFamilies = url.searchParams.get("include_families") === "1";
  const scope = stringParam(url.searchParams.get("scope")) === "healthcare" ? "healthcare" : null;
  const family = stringParam(url.searchParams.get("family"));
  const variable = stringParam(url.searchParams.get("variable"));
  const source = stringParam(url.searchParams.get("source"));
  const level = stringParam(url.searchParams.get("level"));
  const geography = stringParam(url.searchParams.get("geography"));
  const state = stringParam(url.searchParams.get("state"));
  const direction = stringParam(url.searchParams.get("direction"));
  const within = booleanParam(url.searchParams.get("within_tolerance"));
  const search = stringParam(url.searchParams.get("search"));
  const sortBy = stringParam(url.searchParams.get("sort_by")) ?? "abs_relative_error";
  const sortDir = stringParam(url.searchParams.get("sort_dir")) === "asc" ? "asc" : "desc";
  const facetFilters = url.searchParams
    .getAll("facet")
    .map((entry) => {
      const sep = entry.indexOf(":");
      return sep < 0 ? null : ([entry.slice(0, sep), entry.slice(sep + 1)] as const);
    })
    .filter((v): v is readonly [string, string] => v != null);
  const scopedRows = scope === "healthcare" ? rows.filter(isHealthcareTarget) : rows;
  const metadata = targetDiagnosticsMetadata(scopedRows);
  const scopedWithin10Pct = scopedRows.filter(
    (row) => (numberOrNull(row.abs_relative_error) ?? Infinity) <= 0.1,
  ).length;

  let filtered = scopedRows;
  if (family) filtered = filtered.filter((row) => row.family === family);
  if (variable) filtered = filtered.filter((row) => row.variable_key === variable);
  if (source) filtered = filtered.filter((row) => row.source === source);
  if (level) filtered = filtered.filter((row) => row.level === level);
  if (geography) filtered = filtered.filter((row) => row.geography === geography);
  if (state) filtered = filtered.filter((row) => row.state === state);
  const dimensions = variable ? computeDimensions(filtered) : [];
  for (const [key, value] of facetFilters) {
    filtered = filtered.filter((row) => rowFacetValue(row, key) === value);
  }
  if (direction) filtered = filtered.filter((row) => row.direction === direction);
  // The artifact does not populate row.within_tolerance, so derive the "within
  // 10%" fit from the relative error — consistent with the within_10pct counts
  // and the "% on target" shown elsewhere.
  if (within !== null) {
    filtered = filtered.filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      const isWithin = error != null && error <= 0.1;
      return isWithin === within;
    });
  }
  if (search) filtered = filtered.filter((row) => matchesSearch(row, search));
  const sortValue = (row: TargetRow) =>
    rowFacetValue(row, sortBy) ?? row[sortBy];
  filtered = [...filtered].sort((a, b) => {
    const aVal = sortValue(a);
    const bVal = sortValue(b);
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp =
      typeof aVal === "number" && typeof bVal === "number"
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
    return sortDir === "asc" ? cmp : -cmp;
  });

  return {
    available: true,
    source: cal.source,
    release_id: cal.release_id,
    schema_version: cal.schema_version,
    metric: "relative_error",
    families: includeFamilies ? populaceTargetFamilies(scopedRows) : [],
    sources: metadata.sources,
    levels: metadata.levels,
    geographies: metadata.geographies,
    variables: metadata.variables,
    dimensions,
    summary: {
      total_targets: scopedRows.length,
      within_tolerance_count: withinToleranceCount(scopedRows),
      fraction_within_10pct: scopedRows.length ? scopedWithin10Pct / scopedRows.length : null,
      included_target_count: scopedRows.filter((row) => row.calibration_status === "included").length,
      skipped_target_count: scopedRows.filter((row) => row.calibration_status === "skipped").length,
      dropped_target_count: scopedRows.filter((row) => row.calibration_status === "not_materialized").length,
      declared_targets: cal.declared_targets,
      compiled_candidate_targets: cal.compiled_candidate_targets,
    },
    total_targets: scopedRows.length,
    filtered_total: filtered.length,
    returned: filtered.slice(offset, offset + limit).length,
    limit,
    offset,
    has_next: offset + limit < filtered.length,
    display_limit: limit,
    targets: filtered.slice(offset, offset + limit).map(targetResponseRow),
    filters: { scope, family, variable, source, level, geography, state, direction, within_tolerance: within, search, sort_by: sortBy, sort_dir: sortDir },
  };
}

export function latestPopulaceTargetInvestigation(requestUrl: string, cal: Calibration) {
  const url = new URL(requestUrl);
  const target = stringParam(url.searchParams.get("target"));
  if (!target) {
    return {
      available: false,
      detail: "Missing target query parameter.",
    };
  }
  const row = cal.rows.find((candidate) => {
    const ledger = asObject(candidate.ledger);
    return [
      stringValue(candidate.name),
      stringValue(candidate.base_name),
      stringValue(ledger.source_record_id),
      stringValue(ledger.fact_key),
      stringValue(ledger.semantic_fact_key),
      stringValue(ledger.aggregate_fact_key),
      stringValue(ledger.legacy_fact_key),
    ].some((value) => value === target);
  });
  if (!row) {
    return {
      available: false,
      release_id: cal.release_id,
      detail: `Target not found: ${target}`,
    };
  }
  return {
    available: true,
    ...targetInvestigationPacket(row, cal),
  };
}

// --- version-over-version comparison ----------------------------------------
function absRel(row: TargetRow | undefined): number | null {
  return row ? numberOrNull(row.abs_relative_error) : null;
}

function comparableRelative(row: TargetRow | undefined): number | null {
  if (!row || numberOrNull(row.target) === 0) return null;
  return numberOrNull(row.relative_error);
}

function absoluteMiss(row: TargetRow | undefined): number | null {
  if (!row) return null;
  const estimate = numberOrNull(row.final_estimate);
  const target = numberOrNull(row.target);
  return estimate == null || target == null ? null : estimate - target;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function comparisonRowsForScope(rows: TargetRow[], scope?: ComparisonScope | null): TargetRow[] {
  return scope === "healthcare" ? rows.filter(isHealthcareTarget) : rows;
}

function fractionWithin10Pct(rows: TargetRow[]): number | null {
  if (!rows.length) return null;
  const within = rows.filter((row) => {
    const error = numberOrNull(row.abs_relative_error);
    return error != null && error <= 0.1;
  }).length;
  return within / rows.length;
}

function comparisonVariableRows(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const key = String(row.variable_key ?? row.variable ?? "unknown");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  return [...groups.entries()]
    .map(([variable_key, group]) => {
      const relativeRows = group.filter((row) => row.error_kind === "relative");
      const aErrors = relativeRows
        .map((row) => numberOrNull(row.a_error))
        .filter((value): value is number => value != null)
        .map(Math.abs);
      const bErrors = relativeRows
        .map((row) => numberOrNull(row.b_error))
        .filter((value): value is number => value != null)
        .map(Math.abs);
      const aMeanAbsError = mean(aErrors);
      const bMeanAbsError = mean(bErrors);
      const meanAbsDelta =
        aMeanAbsError == null || bMeanAbsError == null
          ? null
          : bMeanAbsError - aMeanAbsError;
      const sample = group[0] ?? {};
      return {
        variable_key,
        source: sample.source ?? null,
        variable: sample.variable ?? null,
        measure: sample.measure ?? null,
        level: sample.level ?? null,
        common_targets: group.length,
        relative_targets: relativeRows.length,
        improved: relativeRows.filter((row) => (numberOrNull(row.abs_rel_delta) ?? 0) < -1e-9).length,
        regressed: relativeRows.filter((row) => (numberOrNull(row.abs_rel_delta) ?? 0) > 1e-9).length,
        unchanged: relativeRows.filter((row) => numberOrNull(row.abs_rel_delta) === 0).length,
        a_mean_abs_error: aMeanAbsError,
        b_mean_abs_error: bMeanAbsError,
        mean_abs_delta: meanAbsDelta,
      };
    })
    .sort((a, b) => {
      const aDelta = numberOrNull(a.mean_abs_delta);
      const bDelta = numberOrNull(b.mean_abs_delta);
      if (aDelta == null && bDelta == null) return b.common_targets - a.common_targets;
      if (aDelta == null) return 1;
      if (bDelta == null) return -1;
      return Math.abs(bDelta) - Math.abs(aDelta) || b.relative_targets - a.relative_targets;
    });
}

// Diff two releases' calibration by matching targets on name. Common targets
// get a fit delta (|b rel err| - |a rel err|; negative = b fits better);
// targets present in only one release are listed as added/removed. Losses
// across releases are NOT comparable when the surfaces differ — flagged.
export function buildComparison(
  a: Calibration,
  b: Calibration,
  options: { scope?: ComparisonScope | null } = {},
) {
  const aRows = comparisonRowsForScope(a.rows, options.scope);
  const bRows = comparisonRowsForScope(b.rows, options.scope);
  // Match on base_name (the period-stripped name) so v1 and v2 releases align —
  // v2 appends an @<period> suffix the older convention lacks.
  const key = (r: TargetRow) => String(r.base_name ?? r.name);
  const aByName = new Map(aRows.map((r) => [key(r), r]));
  const bByName = new Map(bRows.map((r) => [key(r), r]));
  const names = new Set([...aByName.keys(), ...bByName.keys()]);

  const common: TargetRow[] = [];
  let added = 0;
  let removed = 0;
  let improved = 0;
  let regressed = 0;
  for (const name of names) {
    const ar = aByName.get(name);
    const br = bByName.get(name);
    if (ar && br) {
      const aAbs = numberOrNull(ar.target) === 0 ? null : absRel(ar);
      const bAbs = numberOrNull(br.target) === 0 ? null : absRel(br);
      const delta = aAbs != null && bAbs != null ? bAbs - aAbs : null;
      if (delta != null && delta < -1e-9) improved += 1;
      else if (delta != null && delta > 1e-9) regressed += 1;
      const aRelative = comparableRelative(ar);
      const bRelative = comparableRelative(br);
      const errorKind = aRelative != null && bRelative != null ? "relative" : "absolute";
      common.push({
        name,
        target_label: [br.geography ?? ar.geography, br.breakdown ?? ar.breakdown]
          .filter(Boolean)
          .join(" · "),
        source: br.source ?? ar.source,
        target_role: br.target_role ?? ar.target_role,
        source_measure_id: br.source_measure_id ?? ar.source_measure_id,
        variable_key: br.variable_key ?? ar.variable_key,
        variable: br.variable ?? ar.variable,
        measure: br.measure ?? ar.measure,
        level: br.level ?? ar.level,
        breakdown: br.breakdown ?? ar.breakdown,
        dims: br.dims ?? ar.dims,
        target_dimensions: br.target_dimensions ?? ar.target_dimensions,
        geography: br.geography ?? ar.geography,
        a_target: numberOrNull(ar.target),
        b_target: numberOrNull(br.target),
        a_final_estimate: ar.final_estimate ?? null,
        b_final_estimate: br.final_estimate ?? null,
        error_kind: errorKind,
        a_error: errorKind === "relative" ? aRelative : absoluteMiss(ar),
        b_error: errorKind === "relative" ? bRelative : absoluteMiss(br),
        a_relative_error: aRelative,
        b_relative_error: bRelative,
        a_within_tolerance: ar.within_tolerance ?? null,
        b_within_tolerance: br.within_tolerance ?? null,
        abs_rel_delta: delta,
      });
    } else if (ar) {
      removed += 1;
    } else {
      added += 1;
    }
  }
  common.sort(
    (x, y) =>
      Math.abs(numberOrNull(y.abs_rel_delta) ?? 0) -
      Math.abs(numberOrNull(x.abs_rel_delta) ?? 0),
  );

  const surfacesDiffer =
    aRows.length !== bRows.length || added > 0 || removed > 0;
  return {
    a: {
      release_id: a.release_id,
      total_targets: aRows.length,
      initial_loss: a.initial_loss,
      final_loss: a.final_loss,
      loss_kind: a.loss_kind,
      fraction_within_10pct: fractionWithin10Pct(aRows),
    },
    b: {
      release_id: b.release_id,
      total_targets: bRows.length,
      initial_loss: b.initial_loss,
      final_loss: b.final_loss,
      loss_kind: b.loss_kind,
      fraction_within_10pct: fractionWithin10Pct(bRows),
    },
    summary: {
      scope: options.scope ?? null,
      common: common.length,
      added,
      removed,
      improved,
      regressed,
      unchanged: common.length - improved - regressed,
      losses_comparable: !surfacesDiffer && a.loss_kind === b.loss_kind,
      loss_kind: a.loss_kind === b.loss_kind ? a.loss_kind : "mixed",
    },
    variables: comparisonVariableRows(common),
    rows: common,
  };
}

export async function loadComparison(
  aId: string,
  bId: string,
  revalidate: number,
  country: PopulaceCountry = "us",
  scope?: ComparisonScope | null,
) {
  const [a, b] = await Promise.all([
    loadRelease(aId, revalidate, country),
    loadRelease(bId, revalidate, country),
  ]);
  return buildComparison(a, b, { scope });
}
