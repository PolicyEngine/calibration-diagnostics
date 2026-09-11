export type TargetRepresentation =
  | "legacy"
  | "structured"
  | "hierarchy"
  | "mixed"
  | "unknown";

export type TargetRowRepresentation = "legacy" | "structured" | "hierarchy";

export class UnsupportedCalibrationDiagnosticsSchemaError extends Error {}

/**
 * Select the only target reader permitted for a diagnostics artifact.
 *
 * Row shape is deliberately not inspected: the top-level schema version is
 * the compatibility contract between Microcosm and this dashboard.
 */
export function targetRepresentationForSchema(
  schemaVersion: unknown,
): TargetRowRepresentation {
  if (
    typeof schemaVersion !== "number" ||
    !Number.isInteger(schemaVersion)
  ) {
    throw new UnsupportedCalibrationDiagnosticsSchemaError(
      "Calibration diagnostics must declare an integer schema_version.",
    );
  }
  if (schemaVersion >= 2 && schemaVersion <= 6) return "legacy";
  if (schemaVersion === 7) return "structured";
  if (schemaVersion === 8) return "hierarchy";
  throw new UnsupportedCalibrationDiagnosticsSchemaError(
    `Unsupported calibration diagnostics schema_version ${schemaVersion}; ` +
      "this dashboard reads versions 2 through 8.",
  );
}
