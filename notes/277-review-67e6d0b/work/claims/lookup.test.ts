import { expect, test } from "bun:test";
import fixture from "../tests/head/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import { latestMicrocosmTargetInvestigation } from "./head-lookup";
import { latestMicrocosmTargetInvestigation as baseLookup } from "./base-lookup";

const aggregate = structuredClone(fixture.targets.find((row) => row.target_name.includes("excluding_parent_plus"))!);
const cal = { release_id: "fsa-test", rows: [{
  ...aggregate,
  base_name: aggregate.target_name,
  dimension_adapter: "hierarchy",
  target_dimensions: aggregate.hierarchy.dimensions.map((dimension) => ({ key: dimension.id, value_id: dimension.value_id })),
  chronicle: Object.fromEntries(Object.entries(aggregate.metadata).filter(([key]) => key.startsWith("ledger_")).map(([key, value]) => [key.replace(/^ledger_/, ""), value])),
}] };
const row = cal.rows[0];
const lookup = (key: string, release = cal) => latestMicrocosmTargetInvestigation(`https://dashboard.test/api/microcosm/target-investigation?target=${encodeURIComponent(key)}`, release);

test("every aggregate member key and representative identifier names the aggregate; its names resolve directly", () => {
  const identifiers = [
    ...JSON.parse(aggregate.metadata.ledger_member_fact_keys),
    ...["source_record_id", "fact_key", "semantic_fact_key", "aggregate_fact_key", "legacy_fact_key"].map((key) => (row.chronicle as any)[key]),
  ];
  for (const key of identifiers.filter(Boolean)) {
    const answer = lookup(key) as any;
    expect(answer.available).toBe(false);
    expect(answer.member_of).toEqual([{ name: row.name, target_label: row.target_label ?? null }]);
    expect(answer.detail).toContain(String(row.name));
  }
  for (const key of [row.name, row.base_name]) {
    const answer = lookup(String(key)) as any;
    expect(answer.available).toBe(true);
    expect(answer.target.name).toBe(row.name);
  }
  console.log(`Checked ${identifiers.filter(Boolean).length} member/representative identifiers and both target names.`);
}, 30_000);

test("a ratio identity's group-by value and universe set are not lookup keys", () => {
  const age = structuredClone(fixture.targets.find((candidate) => candidate.metadata.ledger_universe_constraint_count)!);
  age.name = "synthetic.age_scaled@2024";
  age.target_name = "synthetic.age_scaled";
  Object.assign(age.metadata, {
    ledger_value_operation: "scaled_by_ratio",
    ledger_member_fact_count: "3",
    ledger_member_fact_keys: JSON.stringify([age.metadata.ledger_fact_key, "num", "den"]),
  });
  const ratioRow = {
    ...age,
    base_name: age.target_name,
    dimension_adapter: "hierarchy",
    target_dimensions: age.hierarchy.dimensions.map((dimension) => ({ key: dimension.id, value_id: dimension.value_id })),
    chronicle: Object.fromEntries(Object.entries(age.metadata).filter(([key]) => key.startsWith("ledger_")).map(([key, value]) => [key.replace(/^ledger_/, ""), value])),
  };
  const release = { release_id: "ratio-test", rows: [ratioRow] };
  expect(lookup(age.metadata.ledger_source_record_id, release).available).toBe(true);
  for (const key of [age.metadata.ledger_layout_groupby_value_id, age.metadata.ledger_universe_constraint_set_key]) {
    expect(key).toBeTruthy();
    expect(lookup(key, release)).toMatchObject({ available: false, member_of: [] });
  }
  console.log(`Unsupported lookup keys: ${age.metadata.ledger_layout_groupby_value_id}; ${age.metadata.ledger_universe_constraint_set_key}`);
});

test("not-found scans remain linear in rows (synthetic aggregate rows, informational timing)", () => {
  for (const count of [1_000, 10_000, 100_000]) {
    const release = { ...cal, rows: Array.from({ length: count }, (_, i) => ({ ...row, name: `aggregate-${i}@2024`, base_name: `aggregate-${i}` })) };
    const url = "https://dashboard.test/api/microcosm/target-investigation?target=no-such-key";
    // Warm each implementation before the timing.
    baseLookup(url, release);
    latestMicrocosmTargetInvestigation(url, release);
    const before = performance.now();
    baseLookup(url, release);
    const middle = performance.now();
    latestMicrocosmTargetInvestigation(url, release);
    const after = performance.now();
    console.log(`${count} aggregate rows, missing key: base ${(middle-before).toFixed(2)} ms; head ${(after-middle).toFixed(2)} ms.`);
  }
}, 30_000);
