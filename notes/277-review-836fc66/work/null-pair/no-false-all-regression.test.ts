import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import edFsaFamily from "../../inputs/dashboard-836fc66/frontend/packages/calibration-tree/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import { buildCalibration, latestMicrocosmTargetDiagnosticsPage } from "../tests-properties/new-package/src/latest-artifact";

const uiSource = readFileSync(new URL("../../inputs/dashboard-836fc66/frontend/components/microcosm/target-row-labels.ts", import.meta.url), "utf8");
const functionSource = uiSource.slice(uiSource.indexOf("export function dimensionSummary"))
  .replace("export function dimensionSummary(row: MicrocosmTargetRow): string", "function dimensionSummary(row)");
const dimensionSummary = new Function("humanizeName", `${functionSource}; return dimensionSummary;`)(() => { throw new Error("unprovided UI formatter reached"); });
const evidence = readFileSync(new URL("./producer.log", import.meta.url), "utf8").trim().split("\n").map(JSON.parse).at(-1);

test("catalog-produced two-cell Loan type A target never reads All", () => {
  expect(evidence.case).toBe("renamed explicit fact, catalog");
  expect(evidence.facts.map((fact: any) => fact.dimensions.loan_type ?? fact.layout.groupby_value_id)).toEqual(["a", "a"]);
  const row = { ...evidence.dashboard_target, name: "combined-balance@2024", target_name: "combined-balance", target: 40, initial_estimate: 40, final_estimate: 40, relative_error: 0 };
  const cal = buildCalibration({ ...edFsaFamily, targets: [row] }, "null-pair-test", null, {}, {}, {}, "uk");
  const [shown] = latestMicrocosmTargetDiagnosticsPage("https://test.invalid/api/microcosm/target-diagnostics", cal).targets;
  expect(dimensionSummary(shown)).toBe("Combines several source cells");
});
