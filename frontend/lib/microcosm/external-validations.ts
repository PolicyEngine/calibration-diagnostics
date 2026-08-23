type JsonObject = Record<string, unknown>;

export interface ExternalValidationKeyRow {
  column: string;
  label: string | null;
  euromodEur: number | null;
  axiomEur: number | null;
  deltaAxiomMinusEuromodEur: number | null;
  classification: string | null;
  explanationClass: string | null;
}

export interface ExternalValidationColumnLedger {
  totalColumns: number | null;
  substantiveColumns: number | null;
  matched: number | null;
  explained: number | null;
  gap: number | null;
  unclassified: number | null;
  toleranceEur: number | null;
  keyRows: ExternalValidationKeyRow[];
}

export interface ExternalValidationSurfaceRow {
  name: string;
  concept: string | null;
  value: number | null;
  year: number | null;
  role: string | null;
  chronicleRecordIds: string[];
  publisher: string | null;
}

export interface ExternalValidation {
  key: string;
  comparator: string | null;
  description: string | null;
  columnLedger: ExternalValidationColumnLedger | null;
  validationSurface: ExternalValidationSurfaceRow[];
}

function objectOrNull(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

/** Return the source prefix of the first Chronicle record id, if one is published. */
export function chroniclePublisher(recordIds: unknown): string | null {
  const first = strings(recordIds)[0]?.trim();
  if (!first) return null;
  return first.split(".", 1)[0] || null;
}

function shapeKeyRows(value: unknown): ExternalValidationKeyRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = objectOrNull(entry);
    const column = stringOrNull(row?.column);
    if (!row || !column) return [];
    return [{
      column,
      label: stringOrNull(row.label),
      euromodEur: numberOrNull(row.euromod_eur),
      axiomEur: numberOrNull(row.axiom_eur),
      deltaAxiomMinusEuromodEur: numberOrNull(row.delta_axiom_minus_euromod_eur),
      classification: stringOrNull(row.classification),
      explanationClass: stringOrNull(row.explanation_class),
    }];
  });
}

function shapeColumnLedger(value: unknown): ExternalValidationColumnLedger | null {
  const ledger = objectOrNull(value);
  if (!ledger) return null;
  return {
    totalColumns: numberOrNull(ledger.total_columns),
    substantiveColumns: numberOrNull(ledger.substantive_columns),
    matched: numberOrNull(ledger.matched),
    explained: numberOrNull(ledger.explained),
    gap: numberOrNull(ledger.gap),
    unclassified: numberOrNull(ledger.unclassified),
    toleranceEur: numberOrNull(ledger.tolerance_eur),
    keyRows: shapeKeyRows(ledger.key_rows),
  };
}

function shapeValidationSurface(value: unknown): ExternalValidationSurfaceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = objectOrNull(entry);
    const name = stringOrNull(row?.name);
    if (!row || !name) return [];
    const chronicleRecordIds = strings(row.chronicle_record_ids);
    return [{
      name,
      concept: stringOrNull(row.concept),
      value: numberOrNull(row.value),
      year: numberOrNull(row.year),
      role: stringOrNull(row.role),
      chronicleRecordIds,
      publisher: chroniclePublisher(chronicleRecordIds),
    }];
  });
}

/**
 * Shape every external-validation block published by a release manifest.
 *
 * Validator keys and user-facing strings are left exactly as the producer
 * supplied them. Unknown or partial blocks degrade to nullable headline fields
 * and empty row arrays so a new country or validator cannot crash the summary.
 */
export function shapeExternalValidations(releaseManifest: unknown): ExternalValidation[] {
  const manifest = objectOrNull(releaseManifest);
  const validations = objectOrNull(manifest?.external_validations);
  if (!validations) return [];

  return Object.entries(validations).flatMap(([key, value]) => {
    const validation = objectOrNull(value);
    if (!validation) return [];
    return [{
      key,
      comparator: stringOrNull(validation.comparator),
      description: stringOrNull(validation.description),
      columnLedger: shapeColumnLedger(validation.column_ledger),
      validationSurface: shapeValidationSurface(validation.validation_surface),
    }];
  });
}
