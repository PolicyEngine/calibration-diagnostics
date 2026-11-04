import { expect, test } from "bun:test";
import cases from "./hierarchy-cases.json";
import { readHierarchyTarget } from "../tests/head/src/hierarchy-target-reader";
import { shownChronicle } from "./chronicle-helpers";

function rowFor(c: typeof cases[number], kind = "hierarchy", operation = "sum") {
  const hierarchy = {
    provider: { id: "provider", label: "Provider" },
    category: { id: "category", label: "Category", provider_id: "provider" },
    geography: { id: "US", label: "United States", level: "country" },
    dimensions: c.dimensions,
    target: { id: "test", label: "Test target" },
  };
  return {
    name: "test@2024",
    metadata: {
      ledger_member_fact_count: "2",
      ledger_member_fact_keys: '["one","two"]',
      ledger_value_operation: operation,
    },
    chronicle: {
      source_record_id: "two",
      fact_key: "two",
      layout_groupby_dimension: c.representative_layout.groupby_dimension,
      layout_groupby_value_id: c.representative_layout.groupby_value_id,
      universe_constraint_set_key: "u",
      universe_constraint_count: 2,
    },
    dimension_adapter: kind,
    target_dimensions: kind === "hierarchy" ? readHierarchyTarget({ hierarchy }).dimensions : [],
  };
}

for (const c of cases) {
  test(`producer hierarchy to shown Chronicle: ${c.name}`, () => {
    const shown = shownChronicle(rowFor(c)) as Record<string, unknown>;
    const shared = !["different_value", "different_dimension"].includes(c.name);
    expect(shown.layout_groupby_value_id).toBe(shared ? c.representative_layout.groupby_value_id : null);
    expect(shown.layout_groupby_value_varies).toBe(!shared);
    expect(shown.universe_constraint_set_key).toBeNull();
    expect(shown.universe_constraint_count).toBeNull();
  });
}

test("same dimension label or same value under another id does not prove the group-by shared", () => {
  const row = rowFor(cases[0]);
  row.target_dimensions = [{ key: "other", label: "Loan type", value: "A", value_id: "a" }] as never;
  expect((shownChronicle(row) as Record<string, unknown>).layout_groupby_value_varies).toBe(true);
  row.target_dimensions = [{ key: "loan_type", label: "Loan type", value: "A", value_id: "b" }] as never;
  expect((shownChronicle(row) as Record<string, unknown>).layout_groupby_value_varies).toBe(true);
});

test("no hierarchy means group-by sharedness unknown, with a null shown value", () => {
  const shown = shownChronicle(rowFor(cases[0], "legacy_name")) as Record<string, unknown>;
  expect(shown.layout_groupby_value_varies).toBeNull();
  expect(shown.layout_groupby_value_id).toBeNull();
});

test("representative identity keeps its universe and raw whitespace, reports shared group-by", () => {
  const shown = shownChronicle(rowFor(cases[3], "hierarchy", "scaled_by_ratio")) as Record<string, unknown>;
  expect(shown.layout_groupby_value_id).toBe(" a ");
  expect(shown.layout_groupby_value_varies).toBe(false);
  expect(shown.universe_constraint_set_key).toBe("u");
  expect(shown.universe_constraint_count).toBe(2);
});

test("single-fact row has no three member fields added", () => {
  const row = rowFor(cases[0]);
  row.metadata.ledger_member_fact_count = "1";
  expect(shownChronicle(row)).toBe(row.chronicle);
});
