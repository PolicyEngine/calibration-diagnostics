import { describe, expect, test } from "bun:test";

import edFsaFamily from "@/packages/calibration-tree/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import hierarchyProbeTargets from "@/packages/calibration-tree/src/fixtures/mixed-groupby-storage/hierarchy-probe-targets.json";
import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";
import {
  buildCalibration,
  latestMicrocosmTargetDiagnosticsPage,
} from "@policyengine/calibration-tree/latest-artifact";

import { dimensionSummary } from "./target-row-labels";

// A release's rows as the targets API sends them to the page.
function pageRows(
  artifact: Record<string, unknown> = edFsaFamily as Record<string, unknown>,
  country: Parameters<typeof buildCalibration>[6] = "us",
): MicrocosmTargetRow[] {
  const release = buildCalibration(
    artifact,
    "populace-us-2024-ed-fsa-family-test",
    null,
    {},
    {},
    {},
    country,
  );
  const url = new URL("https://dashboard.test/api/microcosm/target-diagnostics");
  url.searchParams.set("limit", "500");
  const page = latestMicrocosmTargetDiagnosticsPage(url.toString(), release);
  return JSON.parse(JSON.stringify(page.targets)) as MicrocosmTargetRow[];
}

function fsaRow(rows: MicrocosmTargetRow[], suffix: string): MicrocosmTargetRow {
  const row = rows.find((candidate) => String(candidate.name).endsWith(`${suffix}@2024`));
  if (!row) throw new Error(`No FSA row ends ${suffix}.`);
  return row;
}

describe("the targets page's Dimensions column", () => {
  // The balance excluding Parent PLUS sums five loan types. Its hierarchy
  // lists no dimension, so the dashboard cannot say which loan types its facts
  // share, and the column says it combines several source cells rather than
  // "All", which would include Parent PLUS.
  test("a several-fact target whose hierarchy leaves out its group-by combines several source cells", () => {
    const rows = pageRows();
    expect(
      dimensionSummary(fsaRow(rows, "dollars_outstanding.excluding_parent_plus.dollars_outstanding")),
    ).toBe("Combines several source cells");
    // One loan type, and one state, name themselves.
    expect(
      dimensionSummary(fsaRow(rows, "dollars_outstanding.parent_plus.dollars_outstanding")),
    ).toBe("Parent PLUS");
    expect(dimensionSummary(fsaRow(rows, "portfolio_by_location.2026_03_31.al.dollars_outstanding")))
      .toBe("Alabama");
  });

  // Microcosm's compiler at 0ff293b builds this target from two facts of loan
  // type A, one storing it in its dimensions and one in its layout's
  // group-by, and lists no loan type in its hierarchy (review of 67e6d0b,
  // hierarchy_probe.py). The column claims no loan type varies.
  test("a target whose facts share an unlisted group-by value names no varying dimension", () => {
    const [mixed] = hierarchyProbeTargets as { dashboard_target: Record<string, unknown> }[];
    const row = {
      ...mixed.dashboard_target,
      name: "combined-balance@2024",
      target_name: "combined-balance",
      target: 40,
      initial_estimate: 40,
      final_estimate: 40,
      relative_error: 0,
    };
    const [shown] = pageRows({ ...(edFsaFamily as Record<string, unknown>), targets: [row] }, "uk");
    expect(dimensionSummary(shown)).toBe("Combines several source cells");
  });

  test("the dimensions its hierarchy lists come first, and no dimension is named as varying", () => {
    expect(
      dimensionSummary({
        target_dimensions: [{ key: "sex", label: "Sex", value: "Female" }],
        chronicle: {
          layout_groupby_dimension: "ed_fsa.borrower_age_band",
          layout_groupby_value_id: null,
          layout_groupby_unlisted_across_facts: true,
          member_fact_count: 2,
        },
      }),
    ).toBe("Female · Combines several source cells");
  });

  test("a target whose group-by value reads all, or that has none, says All", () => {
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: "all" } })).toBe("All");
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: null } })).toBe("All");
    expect(dimensionSummary({})).toBe("All");
    // A group-by value hidden without a hierarchy to read: the dashboard says
    // nothing about the facts.
    expect(
      dimensionSummary({
        chronicle: {
          layout_groupby_dimension: "ed_fsa.loan_type",
          layout_groupby_value_id: null,
          layout_groupby_unlisted_across_facts: null,
          member_fact_count: 5,
        },
      }),
    ).toBe("All");
    // A group-by value that shows names itself.
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: "parent_plus" } }))
      .toBe("parent plus");
  });
});
