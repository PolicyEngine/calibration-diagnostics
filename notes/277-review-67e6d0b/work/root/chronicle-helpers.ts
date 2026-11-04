type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;
export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// A count a release writes as metadata. Microcosm stores every metadata value
// as a string (TargetSpec, registry.py:149-150), so "2" reads as 2; a number
// still reads as itself. Anything but a whole, non-negative count reads null.
export function countOrNull(value: unknown): number | null {
  const count =
    typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : numberOrNull(value);
  return count != null && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readableToken(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ");
}

function stringListOrEmpty(value: unknown): string[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) && list.every((item) => typeof item === "string") ? list : [];
}

// How many base cells an allocated_residual_by_ratio receipt lists under
// fact_keys.base (ledger_targets.py:3069-3071, :3188-3189 at 0ff293b), or
// null when it cannot be read.
function allocationBaseCellCount(value: unknown): number | null {
  if (typeof value !== "string") return null;
  try {
    const base = asObject(asObject(JSON.parse(value)).fact_keys).base;
    return Array.isArray(base) ? base.length : null;
  } catch {
    return null;
  }
}

// Whether a multi-fact target's identity is its representative fact alone,
// read from the metadata Microcosm writes for its value operation. When the
// metadata does not say, it is not.
function identityIsRepresentative(metadata: JsonObject): boolean {
  switch (stringValue(metadata.ledger_value_operation)) {
    case "scaled_by_ratio":
      return true;
    case "rolled_forward_by_ratio":
      return countOrNull(metadata.ledger_value_base_cells) === 1;
    case "allocated_residual_by_ratio":
      return allocationBaseCellCount(metadata.ledger_allocation_receipt) === 1;
    default:
      return false;
  }
}

// Whether a target's hierarchy lists the group-by value its Chronicle fields
// carry. Microcosm lists a group-by in the hierarchy only when every fact of
// the target's identity shares it (_inherited_dimensions,
// ledger_targets.py:1578-1611 at 0ff293b, which _calibration_hierarchy applies
// to those facts: :1096-1100, :1369, :1429).
function hierarchyListsGroupBy(row: TargetRow, chronicle: JsonObject): boolean {
  const groupBy = stringValue(chronicle.layout_groupby_dimension)?.trim();
  const value = stringValue(chronicle.layout_groupby_value_id)?.trim();
  if (row.dimension_adapter !== "hierarchy" || !groupBy || !value) return false;
  const dimensions = Array.isArray(row.target_dimensions) ? row.target_dimensions : [];
  return dimensions.some((dimension) => {
    const listed = asObject(dimension);
    return listed.key === groupBy && listed.value_id === value;
  });
}

// Whether the facts of a multi-fact target's identity share the group-by
// value its Chronicle fields carry: "shared" when the identity is one fact or
// the hierarchy lists the value, "differs" when the hierarchy leaves it out,
// and null when the target carries no group-by value or no hierarchy.
function groupByAcrossIdentity(
  row: TargetRow,
  chronicle: JsonObject,
  oneFact: boolean,
): "shared" | "differs" | null {
  if (
    !stringValue(chronicle.layout_groupby_dimension) ||
    !stringValue(chronicle.layout_groupby_value_id)
  ) {
    return null;
  }
  if (oneFact || hierarchyListsGroupBy(row, chronicle)) return "shared";
  return row.dimension_adapter === "hierarchy" ? "differs" : null;
}

// The Chronicle fields a page shows for a target. Microcosm stamps a target's
// single-fact fields from one representative fact (ledger_targets.py:1085-1090
// at 0ff293b). A target built from several facts also lists every one of them,
// ratio operands included, in ledger_member_fact_count and
// ledger_member_fact_keys (_multi_fact_reference_metadata, :1318-1341). Its
// identity depends on its value operation (identity_facts, :1018-1035):
// - scaled_by_ratio: the representative alone, the base cell that its
//   numerator and denominator translate;
// - rolled_forward_by_ratio: its base cells, which ledger_value_base_cells
//   counts (:1174);
// - allocated_residual_by_ratio: the cells its selector matches, the base its
//   ledger_allocation_receipt lists;
// - calendar_year_window_scaled_by_ratio: its window, two years of each
//   series (:4270-4272, :4331);
// - any other operation: every fact.
// The representative is the first base cell (_value_representative_fact,
// :1232-1245), so an identity of one fact is the representative. Such a
// target shows its fields as they are, with member_fact_count and
// member_fact_keys added. An identity of several facts has no one record or
// fact key, so those read null. Its group-by value shows when its hierarchy
// lists it, because every identity fact then shares it, and reads null
// otherwise; layout_groupby_value_varies says which, so the targets page can
// say the target combines several values. Nothing Microcosm writes says
// whether the identity facts share a universe constraint, so its set key and
// count read null.
// ledger_aggregation_varying_dimensions cannot tell either: it compares only
// the facts' dimensions, ratio operands included (:1323, :1626-1646), and it
// lists none for the FSA balance excluding Parent PLUS, whose five loan types
// differ in their group-by value. The row itself keeps every field, so a
// comparison still matches it by fact key. A single-fact target's fields show
// as they are.
function shownChronicle(row: TargetRow): unknown {
  const metadata = asObject(row.metadata);
  const memberFactCount = countOrNull(metadata.ledger_member_fact_count);
  if (memberFactCount == null || memberFactCount <= 1) return row.chronicle;
  const chronicle = asObject(row.chronicle);
  const oneFact = identityIsRepresentative(metadata);
  const groupBy = groupByAcrossIdentity(row, chronicle, oneFact);
  const members = {
    member_fact_count: memberFactCount,
    member_fact_keys: stringListOrEmpty(metadata.ledger_member_fact_keys),
    layout_groupby_value_varies: groupBy == null ? null : groupBy === "differs",
  };
  if (oneFact) return { ...chronicle, ...members };
  return {
    ...chronicle,
    ...members,
    fact_key: null,
    source_record_id: null,
    semantic_fact_key: null,
    aggregate_fact_key: null,
    legacy_fact_key: null,
    layout_groupby_value_id: groupBy === "shared" ? chronicle.layout_groupby_value_id : null,
    universe_constraint_set_key: null,
    universe_constraint_count: null,
  };
}


export { shownChronicle, hierarchyListsGroupBy };
