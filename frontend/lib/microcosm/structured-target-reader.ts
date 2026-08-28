import {
  readStructuredDimensions,
  type StructuredDimensionDefinition,
  type StructuredTargetDimension,
} from "./structured-dimension-reader";

type JsonObject = Record<string, unknown>;

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
  const structured = readStructuredDimensions(values, definitions);
  const geography = structured.geography ?? nationalGeography;
  const level = structured.level ?? "national";
  const { dimensions } = structured;

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
