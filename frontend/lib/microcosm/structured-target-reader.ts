type JsonObject = Record<string, unknown>;

export interface StructuredDimensionDefinition {
  label: string;
  role?: "geography";
  level?: string;
  values?: Record<string, string>;
  order?: string[];
}

export interface StructuredTargetDimension {
  key: string;
  label: string;
  value: string;
  source_key: string;
  raw_value: string;
  rank?: number;
}

export interface StructuredTargetIdentity {
  source: string;
  sourceLabel: string | null;
  sourceCitation: string | null;
  sourceUrl: string | null;
  variable: string;
  variableLabel: string | null;
  measure: string | null;
  geography: string;
  level: string;
  dimensions: StructuredTargetDimension[];
  breakdown: string;
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function titleCase(value: string): string {
  return value
    .replace(/[_:./#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function dimensionLabel(value: string): string {
  if (value === "us:statutes/26/62#adjusted_gross_income") return "Income band";
  if (value === "census_stc.item") return "Item";
  if (value === "hhs_acf_tanf.spending_category") return "Spending category";
  if (value.startsWith("cms_medicaid.")) {
    return titleCase(value.replace(/^cms_medicaid\./, ""));
  }
  const hash = value.split("#").at(-1);
  const last = hash?.split(".").at(-1) ?? value;
  return titleCase(last);
}

function dimensionKey(label: string): string {
  return `bd_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function dimensionValue(
  label: string,
  rawValue: string,
  valueLabels?: Readonly<Record<string, string>>,
): string {
  const explicit = valueLabels && Object.hasOwn(valueLabels, rawValue)
    ? valueLabels[rawValue]
    : undefined;
  if (explicit) return explicit;
  if (label.toLowerCase() === "age band") {
    const range = /^(\d+)_(\d+)$/.exec(rawValue);
    if (range) return `${range[1]}–${range[2]}`;
    const openEnded = /^(\d+)_plus$/.exec(rawValue);
    if (openEnded) return `${openEnded[1]}+`;
  }
  return titleCase(rawValue);
}

export function readStructuredTarget(
  row: JsonObject,
  definitions: Record<string, StructuredDimensionDefinition>,
  nationalGeography: string,
): StructuredTargetIdentity {
  const source = isPlainObject(row.source) ? row.source : {};
  const variable = isPlainObject(row.variable) ? row.variable : {};
  const values = isPlainObject(row.dimensions) ? row.dimensions : {};
  const sourceId = stringValue(source.id) ?? "other";
  const variableId = stringValue(variable.id) ?? "unknown";
  let geography = nationalGeography;
  let level = "national";
  const dimensions: StructuredTargetDimension[] = [];

  for (const [id, raw] of Object.entries(values)) {
    const rawValue = stringValue(raw);
    if (!rawValue) continue;
    const definition = definitions[id];
    const label = definition?.label ?? dimensionLabel(id);
    const value = dimensionValue(label, rawValue, definition?.values);
    const rankOrder = definition?.order ??
      (definition?.values ? Object.keys(definition.values) : undefined);
    const rank = rankOrder?.indexOf(rawValue) ?? -1;
    if (definition?.role === "geography") {
      geography = value;
      level = definition.level ?? "region";
      continue;
    }
    dimensions.push({
      key: dimensionKey(label),
      label,
      value,
      source_key: id,
      raw_value: rawValue,
      ...(rank >= 0 ? { rank } : {}),
    });
  }

  return {
    source: sourceId,
    sourceLabel: stringValue(source.label),
    sourceCitation: stringValue(source.citation),
    sourceUrl: stringValue(source.url),
    variable: variableId,
    variableLabel: stringValue(variable.label),
    measure: stringValue(variable.measure),
    geography,
    level,
    dimensions,
    breakdown: dimensions.map((dimension) => dimension.value).join(" · "),
  };
}
