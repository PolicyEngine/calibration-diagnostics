// Pure-HF data layer for the populace-US dashboard. No committed snapshot:
// every release's manifests and per-target calibration diagnostics are read
// live from the policyengine/populace-us Hugging Face dataset, resolved through
// latest.json (current release) or by id (any release, for version compare).

type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;

export const POPULACE_HF_REPO = process.env.POPULACE_HF_REPO ?? "policyengine/populace-us";
export const POPULACE_HF_REVISION = process.env.POPULACE_HF_REVISION ?? "main";

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
  return readableToken(value);
}

function readableFilterValue(key: string, value: string | null): string | null {
  if (key === "ledger_filter_eitc_child_count") {
    return qualifyingChildrenFromCount(value);
  }
  return readableDimensionValue(value);
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
  if (/^-?inf$/i.test(token)) return token.startsWith("-") ? -Infinity : Infinity;
  const negative = token.startsWith("-");
  const magnitude = parseFloat(token);
  if (!Number.isFinite(magnitude)) return 0;
  const mult = /k$/i.test(token) ? 1e3 : /m$/i.test(token) ? 1e6 : 1;
  return (negative ? -1 : 1) * Math.abs(magnitude) * mult;
}

function bandLowerBound(label: string): number {
  const body = label.replace(/^AGI in /, "");
  const match = /^(-?inf|-?\d+(?:\.\d+)?[km]?)-(-?inf|-?\d+(?:\.\d+)?[km]?)$/i.exec(body);
  return match ? parseAmount(match[1]) : 0;
}

function sortDimensionValues(label: string, values: string[]): string[] {
  if (label === "Income band") return [...values].sort((a, b) => bandLowerBound(a) - bandLowerBound(b));
  if (label === "Age") return [...values].sort((a, b) => Number(a) - Number(b));
  if (label === "Qualifying children") {
    const rank = (value: string) =>
      [
        "all qualifying children",
        "no qualifying children",
        "one qualifying child",
        "two qualifying children",
        "three or more qualifying children",
      ].indexOf(value);
    return [...values].sort((a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar >= 0 || br >= 0) return (ar >= 0 ? ar : 99) - (br >= 0 ? br : 99);
      return a.localeCompare(b);
    });
  }
  return [...values].sort((a, b) => (a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b)));
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

// Enrich a raw target row. Schema v2 publishes the canonical registry fields
// (source citation, entity, aggregation, measure, period, target_name); we keep
// the parsed geography/source/variable/breakdown for navigation and surface the
// published metadata alongside. v1 rows simply lack those extra fields.
function enrichTargetRow(row: TargetRow): TargetRow {
  const fullName = String(row.name ?? "");
  // v2 carries target_name (no @period); else strip any @period from the name.
  const baseName = String(row.target_name ?? fullName.split("@")[0]);
  const target = numberOrNull(row.target);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  const errorKind = target === 0 ? "absolute" : "relative";
  const rawFinalError = numberOrNull(row.relative_error) ?? relativeError(final, target);
  const rawInitialError = relativeError(initial, target);
  const initialError =
    errorKind === "absolute" && initial != null && target != null
      ? initial - target
      : rawInitialError;
  const finalError =
    errorKind === "absolute" && final != null && target != null
      ? final - target
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
    error_kind: errorKind,
    initial_error: initialError,
    final_error: finalError,
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
    initial_relative_error: errorKind === "relative" ? initialError : null,
    abs_relative_error: errorKind === "relative" ? absFinalError : null,
    improvement,
    direction: finalError == null ? null : finalError > 0 ? "over" : finalError < 0 ? "under" : "exact",
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
    return "This target is sliced by qualifying children, but the release artifact reports no compiled filter for that slice. Initial and final estimates may reflect a broader EITC aggregate rather than this child group.";
  }
  return "This target is part of a sliced target family, but the release artifact reports no compiled filter for this slice and sibling slices share the same estimate. Initial and final estimates may reflect a broader aggregate than this target row.";
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

function withinToleranceCount(rows: TargetRow[]): number {
  return rows.filter((row) => row.within_tolerance === true).length;
}

export function populaceTargetFamilies(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.family ?? "")))].sort();
}

export function populaceTargetSources(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.source ?? "")))].filter(Boolean).sort();
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
      return {
        variable_key,
        source: String(first.source ?? ""),
        variable: String(first.variable ?? ""),
        measure: first.measure ? String(first.measure) : null,
        level: String(first.level ?? ""),
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
  fraction_within_10pct: number | null;
  loss_trajectory: number[];
  skipped: JsonObject[];
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
  variables: ReturnType<typeof populaceVariableSummary>;
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
  const rows = addEstimateScopeWarnings(targets.map(enrichTargetRow));
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
    fraction_within_10pct: numberOrNull(diag.fraction_within_10pct),
    loss_trajectory: Array.isArray(diag.loss_trajectory) ? (diag.loss_trajectory as number[]) : [],
    skipped: Array.isArray(diag.skipped) ? (diag.skipped as JsonObject[]) : [],
    build_manifest: buildManifest,
    release_manifest: releaseManifest,
    rows,
  };
}

// --- HF access --------------------------------------------------------------
export function hfResolveUrl(path: string): string {
  return `https://huggingface.co/datasets/${POPULACE_HF_REPO}/resolve/${POPULACE_HF_REVISION}/${path}`;
}

async function hfJson(url: string, revalidate: number): Promise<JsonObject> {
  const res = await fetch(url, { next: { revalidate } });
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

export async function loadReleases(revalidate: number): Promise<ReleaseEntry[]> {
  const url = `https://huggingface.co/api/datasets/${POPULACE_HF_REPO}/tree/${POPULACE_HF_REVISION}/releases?recursive=true`;
  const res = await fetch(url, { next: { revalidate } });
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

export async function loadPointerReleaseId(revalidate: number): Promise<{ release_id: string; updated_at: string | null }> {
  const pointer = await hfJson(hfResolveUrl("latest.json"), revalidate);
  return {
    release_id: String(pointer.release_id ?? ""),
    updated_at: typeof pointer.updated_at === "string" ? pointer.updated_at : null,
  };
}

// Load one release's manifests + calibration diagnostics. releaseId "latest"
// resolves through the pointer.
export async function loadRelease(releaseId: string, revalidate: number): Promise<Calibration> {
  const cacheKey = `${releaseId || "latest"}:${revalidate}`;
  const now = Date.now();
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = loadReleaseUncached(releaseId, revalidate);
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

async function loadReleaseUncached(releaseId: string, revalidate: number): Promise<Calibration> {
  let id = releaseId;
  let updatedAt: string | null = null;
  if (releaseId === "latest" || !releaseId) {
    const ptr = await loadPointerReleaseId(revalidate);
    id = ptr.release_id;
    updatedAt = ptr.updated_at;
  }
  const prefix = `releases/${id}`;
  const [diag, buildManifest, releaseManifest] = await Promise.all([
    hfJson(hfResolveUrl(`${prefix}/calibration_diagnostics.json`), revalidate),
    hfJson(hfResolveUrl(`${prefix}/build_manifest.json`), revalidate).catch(() => ({})),
    hfJson(hfResolveUrl(`${prefix}/release_manifest.json`), revalidate).catch(() => ({})),
  ]);
  return buildCalibration(diag, id, updatedAt, buildManifest, releaseManifest);
}

function targetDiagnosticsMetadata(rows: TargetRow[]): TargetDiagnosticsMetadata {
  const cached = targetDiagnosticsMetadataCache.get(rows);
  if (cached) return cached;
  const metadata = {
    sources: populaceTargetSources(rows),
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
    error_kind: row.error_kind,
    initial_error: row.initial_error,
    final_error: row.final_error,
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
    estimate_warning: row.estimate_warning,
    initial_relative_error: row.initial_relative_error,
    abs_relative_error: row.abs_relative_error,
    improvement: row.improvement,
    direction: row.direction,
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
    fraction_within_10pct: cal.fraction_within_10pct,
    loss_trajectory: cal.loss_trajectory,
    skipped: cal.skipped,
    total_targets: cal.rows.length,
    within_tolerance_count: withinToleranceCount(cal.rows),
    family_fit: familyFitSummary(cal.rows),
  };
}

function worstFit(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => numberOrNull(row.abs_relative_error) != null)
    .sort((a, b) => (numberOrNull(b.abs_relative_error) ?? 0) - (numberOrNull(a.abs_relative_error) ?? 0))
    .slice(0, limit);
}

function biggestImprovements(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => numberOrNull(row.improvement) != null)
    .sort((a, b) => (numberOrNull(b.improvement) ?? 0) - (numberOrNull(a.improvement) ?? 0))
    .slice(0, limit);
}

export function latestPopulaceCalibrationHighlights(cal: Calibration, limit = 15) {
  return {
    worst_fit: worstFit(cal.rows, limit),
    biggest_improvements: biggestImprovements(cal.rows, limit),
  };
}

export function latestPopulaceTargetDiagnosticsPage(requestUrl: string, cal: Calibration) {
  const rows = cal.rows;
  const url = new URL(requestUrl);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
  const includeFamilies = url.searchParams.get("include_families") === "1";
  const family = stringParam(url.searchParams.get("family"));
  const variable = stringParam(url.searchParams.get("variable"));
  const source = stringParam(url.searchParams.get("source"));
  const level = stringParam(url.searchParams.get("level"));
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
  const metadata = targetDiagnosticsMetadata(rows);

  let filtered = rows;
  if (family) filtered = filtered.filter((row) => row.family === family);
  if (variable) filtered = filtered.filter((row) => row.variable_key === variable);
  if (source) filtered = filtered.filter((row) => row.source === source);
  if (level) filtered = filtered.filter((row) => row.level === level);
  if (state) filtered = filtered.filter((row) => row.state === state);
  const dimensions = variable ? computeDimensions(filtered) : [];
  for (const [key, value] of facetFilters) {
    filtered = filtered.filter((row) => rowFacetValue(row, key) === value);
  }
  if (direction) filtered = filtered.filter((row) => row.direction === direction);
  if (within !== null) filtered = filtered.filter((row) => row.within_tolerance === within);
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
    families: includeFamilies ? populaceTargetFamilies(rows) : [],
    sources: metadata.sources,
    variables: metadata.variables,
    dimensions,
    summary: {
      total_targets: rows.length,
      within_tolerance_count: withinToleranceCount(rows),
      fraction_within_10pct: cal.fraction_within_10pct,
    },
    total_targets: rows.length,
    filtered_total: filtered.length,
    returned: filtered.slice(offset, offset + limit).length,
    limit,
    offset,
    has_next: offset + limit < filtered.length,
    display_limit: limit,
    targets: filtered.slice(offset, offset + limit).map(targetResponseRow),
    filters: { family, variable, source, level, state, direction, within_tolerance: within, search, sort_by: sortBy, sort_dir: sortDir },
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

// Diff two releases' calibration by matching targets on name. Common targets
// get a fit delta (|b rel err| - |a rel err|; negative = b fits better);
// targets present in only one release are listed as added/removed. Losses
// across releases are NOT comparable when the surfaces differ — flagged.
export function buildComparison(a: Calibration, b: Calibration) {
  // Match on base_name (the period-stripped name) so v1 and v2 releases align —
  // v2 appends an @<period> suffix the older convention lacks.
  const key = (r: TargetRow) => String(r.base_name ?? r.name);
  const aByName = new Map(a.rows.map((r) => [key(r), r]));
  const bByName = new Map(b.rows.map((r) => [key(r), r]));
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
        variable_key: br.variable_key ?? ar.variable_key,
        variable: br.variable ?? ar.variable,
        breakdown: br.breakdown ?? ar.breakdown,
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
    a.rows.length !== b.rows.length || added > 0 || removed > 0;
  return {
    a: {
      release_id: a.release_id,
      total_targets: a.rows.length,
      initial_loss: a.initial_loss,
      final_loss: a.final_loss,
      fraction_within_10pct: a.fraction_within_10pct,
    },
    b: {
      release_id: b.release_id,
      total_targets: b.rows.length,
      initial_loss: b.initial_loss,
      final_loss: b.final_loss,
      fraction_within_10pct: b.fraction_within_10pct,
    },
    summary: {
      common: common.length,
      added,
      removed,
      improved,
      regressed,
      unchanged: common.length - improved - regressed,
      losses_comparable: !surfacesDiffer,
    },
    rows: common,
  };
}

export async function loadComparison(aId: string, bId: string, revalidate: number) {
  const [a, b] = await Promise.all([
    loadRelease(aId, revalidate),
    loadRelease(bId, revalidate),
  ]);
  return buildComparison(a, b);
}
