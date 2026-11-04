import { describe, expect, test } from "bun:test";

import edFsaFamily from "@/packages/calibration-tree/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import type { MicrocosmTargetRow } from "@/lib/api/hooks/use-microcosm";
import {
  buildCalibration,
  latestMicrocosmTargetDiagnosticsPage,
} from "@policyengine/calibration-tree/latest-artifact";

import { dimensionSummary } from "./target-row-labels";

// The FSA family's rows as the targets API sends them to the page.
function fsaPageRows(): MicrocosmTargetRow[] {
  const release = buildCalibration(
    edFsaFamily as Record<string, unknown>,
    "populace-us-2024-ed-fsa-family-test",
    null,
    {},
    {},
    {},
    "us",
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
  // The balance excluding Parent PLUS sums five loan types. It carries no
  // dimension, and its group-by value is hidden because its facts differ in
  // it, so the column says so rather than "All", which would include Parent
  // PLUS.
  test("a target whose facts differ in their group-by value says it combines several", () => {
    const rows = fsaPageRows();
    expect(
      dimensionSummary(fsaRow(rows, "dollars_outstanding.excluding_parent_plus.dollars_outstanding")),
    ).toBe("Combines several loan type values");
    // One loan type, and one state, name themselves.
    expect(
      dimensionSummary(fsaRow(rows, "dollars_outstanding.parent_plus.dollars_outstanding")),
    ).toBe("Parent PLUS");
    expect(dimensionSummary(fsaRow(rows, "portfolio_by_location.2026_03_31.al.dollars_outstanding")))
      .toBe("Alabama");
  });

  test("the dimensions its facts share come first", () => {
    expect(
      dimensionSummary({
        target_dimensions: [{ key: "sex", label: "Sex", value: "Female" }],
        chronicle: {
          layout_groupby_dimension: "ed_fsa.loan_type",
          layout_groupby_value_id: null,
          layout_groupby_value_varies: true,
          member_fact_count: 2,
        },
      }),
    ).toBe("Female · Combines several loan type values");
  });

  test("a target whose group-by value reads all, or that has none, says All", () => {
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: "all" } })).toBe("All");
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: null } })).toBe("All");
    expect(dimensionSummary({})).toBe("All");
    // A group-by value hidden for another reason: the dashboard cannot tell
    // whether the facts share it.
    expect(
      dimensionSummary({
        chronicle: {
          layout_groupby_dimension: "ed_fsa.loan_type",
          layout_groupby_value_id: null,
          layout_groupby_value_varies: null,
          member_fact_count: 5,
        },
      }),
    ).toBe("All");
    // A group-by value that shows names itself.
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: "parent_plus" } }))
      .toBe("parent plus");
  });
});
