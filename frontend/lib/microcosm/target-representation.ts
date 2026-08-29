export type TargetRepresentation = "legacy" | "structured" | "mixed" | "unknown";
export type TargetRowRepresentation = "legacy" | "structured";

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

export function classifyTargetRow(row: JsonObject): TargetRowRepresentation {
  if (isCompleteStructuredTarget(row)) return "structured";
  if (isLegacyTarget(row)) return "legacy";
  throw new Error(
    "Calibration target rows must use either complete structured identity fields or legacy fields.",
  );
}

export function classifyTargetRepresentation(
  rows: readonly JsonObject[],
): TargetRepresentation {
  if (rows.length === 0) return "unknown";
  const representations = new Set(rows.map(classifyTargetRow));
  if (representations.size > 1) return "mixed";
  return representations.has("structured") ? "structured" : "legacy";
}
