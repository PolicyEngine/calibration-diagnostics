import { expect, test } from "bun:test";
import fixture from "../tests/head/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import { buildCalibration, latestMicrocosmTargetDiagnosticsPage } from "../tests/isolated-head/src/latest-artifact";

test("schema 6 FSA-like aggregate keeps legacy dimensions independently of shown group-by", () => {
  const row = structuredClone(fixture.targets.find((row: any) => row.metadata.ledger_member_fact_count === "5")!);
  delete (row as any).hierarchy;
  const release = buildCalibration({ ...fixture, schema_version: 6, targets: [row] }, "schema6-probe", null, {}, {}, {}, "us");
  const page = latestMicrocosmTargetDiagnosticsPage("https://test.invalid/api/microcosm/target-diagnostics", release);
  console.log(JSON.stringify(page.targets[0]));
  const chronicle = page.targets[0].chronicle as any;
  expect(chronicle.layout_groupby_value_id).toBeNull();
  expect(chronicle.layout_groupby_value_varies).toBeNull();
  expect(page.targets[0].target_dimensions).toMatchObject([{ value: "stafford unsubsidized" }]);
});

test("schema 6 recognized filter decomposition precedes representative metadata dimensions", () => {
  const row = structuredClone(fixture.targets.find((row: any) => row.metadata.ledger_member_fact_count === "5")!);
  delete (row as any).hierarchy;
  (row as any).filter = "cell_be2_female_18_64";
  const release = buildCalibration({ ...fixture, schema_version: 6, targets: [row] }, "schema6-filter-probe", null, {}, {}, {}, "be");
  const page = latestMicrocosmTargetDiagnosticsPage("https://test.invalid/api/microcosm/target-diagnostics", release);
  console.log(JSON.stringify({ dimension_adapter: page.targets[0].dimension_adapter, target_dimensions: page.targets[0].target_dimensions }));
  expect(page.targets[0].target_dimensions).toMatchObject([{ value: "Female" }, { value: "18–64" }]);
});
