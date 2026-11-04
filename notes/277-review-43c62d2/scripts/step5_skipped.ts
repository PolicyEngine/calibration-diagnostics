// Step 5: what the dashboard shows when calibration skips the multi-fact FSA
// target, and when it skips a target named by the representative's record id.
// Usage: bun run step5_skipped.ts <worktree>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const PKG = join(process.argv[2], "frontend/packages/calibration-tree/src");
const la = await import(join(PKG, "latest-artifact.ts"));
const fsa = JSON.parse(readFileSync(join(PKG, "fixtures/ed-fsa-family/ed-fsa-family-schema-8.json"), "utf8"));
const AGG = "ed_fsa.portfolio_by_loan_type.fy2026_q2.dollars_outstanding.excluding_parent_plus.dollars_outstanding";
const STAFFORD = "ed_fsa.portfolio_by_loan_type.fy2026_q2.dollars_outstanding.stafford_unsubsidized.dollars_outstanding";
const show = (label: string, skipped: unknown[]) => {
  const doc = { ...fsa, skipped_targets: skipped, skipped };
  const cal = la.buildCalibration(doc, "populace-us-2024", null, {}, {}, {}, "us");
  const row = cal.rows.find((r: any) => r.target_name === AGG);
  const url = new URL("https://dashboard.test/api/microcosm/target-diagnostics");
  url.searchParams.set("search", "excluding_parent_plus");
  const listed = la.latestMicrocosmTargetDiagnosticsPage(url.toString(), cal).targets.find((t: any) => t.target_name === AGG);
  console.log(label, "->", row.calibration_status, "|", row.calibration_status_reason, "| page:", listed?.calibration_status,
    "| skipped_target_count", la.latestMicrocosmCalibrationSummary(cal).skipped_target_count ?? "(n/a)");
};
show("no skip", []);
show("skip the aggregate by name", [{ name: AGG, reason: "KeyError: x" }]);
show("skip the aggregate by name@period", [{ name: `${AGG}@2024`, reason: "KeyError: x" }]);
show("skip a target named by the representative's record id", [{ name: STAFFORD, reason: "KeyError: stafford" }]);
