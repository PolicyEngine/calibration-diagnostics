import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import fixture from "../tests/head/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import { buildCalibration as baseCalibration, latestMicrocosmTargetDiagnosticsPage as basePage } from "../tests/isolated-base/src/latest-artifact";
import { buildCalibration as headCalibration, latestMicrocosmTargetDiagnosticsPage as headPage } from "../tests/isolated-head/src/latest-artifact";

// This JSON line is the output of the actual catalog resolver/compiler;
// the Python harness only substitutes unavailable output-model classes.
const evidence = JSON.parse(readFileSync(new URL("../identity/hierarchy_probe.log", import.meta.url), "utf8").split("\n")[0]);
const row = {
  ...evidence.dashboard_target,
  name: "combined-balance@2024",
  target_name: "combined-balance",
  target: 40,
  initial_estimate: 40,
  final_estimate: 40,
  relative_error: 0,
};

for (const [version, build, page] of [["base", baseCalibration, basePage], ["head", headCalibration, headPage]] as const) {
  test(`${version}: one semantic loan type must not be reported as several loan type values`, () => {
    const semanticValues = evidence.facts.map((fact: any) => fact.dimensions.loan_type ?? fact.layout.groupby_value_id);
    expect(new Set(semanticValues).size).toBe(1);
    const release = build({ ...fixture, targets: [row] }, "mixed-storage-test", null, {}, {}, {}, "uk");
    const response = page("https://test.invalid/api/microcosm/target-diagnostics", release);
    const chronicle = response.targets[0].chronicle as any;
    console.log(JSON.stringify({ version, semanticValues, dimensions: response.targets[0].target_dimensions, shown: chronicle }));
    expect(chronicle.layout_groupby_value_varies).not.toBe(true);
  });
}
