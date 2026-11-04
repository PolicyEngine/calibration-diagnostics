import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import edFsaFamily from "../../inputs/dashboard-836fc66/frontend/packages/calibration-tree/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import { buildCalibration as oldBuild, latestMicrocosmTargetDiagnosticsPage as oldPage } from "../tests-properties/old-package/src/latest-artifact";
import { buildCalibration as newBuild, latestMicrocosmTargetDiagnosticsPage as newPage } from "../tests-properties/new-package/src/latest-artifact";

// Copy each exact UI function with its imports removed. The tested null-pair
// branches never call humanizeName or titleFromIdentifier; fail if they do.
function readSummary(commit: string) {
  const uiSource = readFileSync(new URL(`../../inputs/dashboard-${commit}/frontend/components/microcosm/target-row-labels.ts`, import.meta.url), "utf8");
  const functionSource = uiSource.slice(uiSource.indexOf("export function dimensionSummary"))
    .replace("export function dimensionSummary(row: MicrocosmTargetRow): string", "function dimensionSummary(row)");
  return new Function("humanizeName", "titleFromIdentifier", `${functionSource}; return dimensionSummary;`)(
    () => { throw new Error("unprovided UI formatter reached"); },
    () => { throw new Error("unprovided UI formatter reached"); },
  );
}
const summaries = { old: readSummary("67e6d0b"), new: readSummary("836fc66") };
const evidence = readFileSync(new URL("./producer.log", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);

for (const [version, build, page] of [["old", oldBuild, oldPage], ["new", newBuild, newPage]] as const) {
  for (const item of evidence) {
    test(`${version}: ${item.case}`, () => {
      const semanticValues = item.facts.map((fact: any) => fact.dimensions.loan_type ?? fact.layout.groupby_value_id);
      expect(semanticValues).toEqual(["a", "a"]);
      const row = { ...item.dashboard_target, name: "combined-balance@2024", target_name: "combined-balance", target: 40, initial_estimate: 40, final_estimate: 40, relative_error: 0 };
      const cal = build({ ...edFsaFamily, targets: [row] }, "null-pair-test", null, {}, {}, {}, "uk");
      const [shown] = page("https://test.invalid/api/microcosm/target-diagnostics", cal).targets;
      const summary = version === "old" && item.layout_pair[0] !== null
        ? "<old pair branch not run: omitted formatter>"
        : summaries[version](shown);
      console.log(JSON.stringify({ version, case: item.case, representative: item.representative, target_dimensions: shown.target_dimensions, chronicle: shown.chronicle, summary }));
      expect(shown.target_dimensions).toEqual([]);
      if (item.layout_pair[0] === null) {
        expect(summary).toBe("All");
        expect((shown.chronicle as any)[version === "old" ? "layout_groupby_value_varies" : "layout_groupby_unlisted_across_facts"]).toBeNull();
      } else if (version === "new") {
        expect(summary).toBe("Combines several source cells");
      }
    });
  }
}
