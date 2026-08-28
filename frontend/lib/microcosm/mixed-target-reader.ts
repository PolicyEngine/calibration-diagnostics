import {
  chroniclePublisherFromMetadata,
  type ParsedLegacyTarget,
} from "./legacy-target-reader";

type JsonObject = Record<string, unknown>;

export interface MixedStructuredDimensions {
  geography: string | null;
  level: string | null;
  dimensions: ReadonlyArray<{ value: string }>;
}

export interface MixedTargetIdentity {
  parsed: ParsedLegacyTarget;
  sourceLabel: string | null;
  sourceCitation: string | null;
  sourceUrl: string | null;
  variableLabel: string | null;
  variableMeasure: string | null;
  hasStructuredSource: boolean;
  hasStructuredVariable: boolean;
}

interface StructuredSource {
  id: string | null;
  citation: string | null;
  label: string | null;
  url: string | null;
}

interface StructuredVariable {
  id: string;
  label: string | null;
  measure: string | null;
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function structuredSource(value: unknown): StructuredSource | null {
  if (!isPlainObject(value)) return null;
  return {
    id: stringValue(value.id),
    citation: stringValue(value.citation),
    label: stringValue(value.label),
    url: stringValue(value.url),
  };
}

function structuredVariable(value: unknown): StructuredVariable | null {
  if (!isPlainObject(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    label: stringValue(value.label),
    measure: stringValue(value.measure),
  };
}

export function readMixedTarget(
  row: JsonObject,
  legacy: ParsedLegacyTarget,
  structuredDimensions: MixedStructuredDimensions | null,
): MixedTargetIdentity {
  const metadata = isPlainObject(row.metadata) ? row.metadata : {};
  const source = structuredSource(row.source);
  const variable = structuredVariable(row.variable);
  const publisher = chroniclePublisherFromMetadata(metadata) ?? source?.id ?? legacy.source;
  const parsed: ParsedLegacyTarget = {
    ...legacy,
    geography: structuredDimensions?.geography ?? legacy.geography,
    level: structuredDimensions?.level ?? legacy.level,
    source: publisher,
    variable: variable?.id ?? legacy.variable,
    breakdown: structuredDimensions
      ? structuredDimensions.dimensions.map((dimension) => dimension.value).join(" · ")
      : legacy.breakdown,
  };
  return {
    parsed,
    sourceLabel: source?.label ?? null,
    sourceCitation: source?.citation ?? null,
    sourceUrl: source?.url ?? null,
    variableLabel: variable?.label ?? null,
    variableMeasure: variable?.measure ?? null,
    hasStructuredSource: source?.id != null,
    hasStructuredVariable: variable != null,
  };
}
