export type TargetRepresentation = "legacy" | "structured" | "mixed" | "unknown";

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isCompleteStructuredTarget(row: JsonObject): boolean {
  return (
    isPlainObject(row.source) &&
    nonEmptyString(row.source.id) &&
    isPlainObject(row.variable) &&
    nonEmptyString(row.variable.id) &&
    isPlainObject(row.dimensions)
  );
}

export function isLegacyTarget(row: JsonObject): boolean {
  return (
    !isPlainObject(row.source) &&
    !isPlainObject(row.variable) &&
    !isPlainObject(row.dimensions)
  );
}

export function classifyTargetRepresentation(
  rows: readonly JsonObject[],
): TargetRepresentation {
  if (rows.length === 0) return "unknown";
  if (rows.every(isCompleteStructuredTarget)) return "structured";
  if (rows.every(isLegacyTarget)) return "legacy";
  return "mixed";
}
