import { describe, expect, test } from "bun:test";

import edFsaFamily from "@/packages/calibration-tree/src/fixtures/ed-fsa-family/ed-fsa-family-schema-8.json";
import hierarchyProbeTargets from "@/packages/calibration-tree/src/fixtures/mixed-groupby-storage/hierarchy-probe-targets.json";
import listedDimensionTargets from "@/packages/calibration-tree/src/fixtures/mixed-groupby-storage/listed-dimension-targets.json";
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

  // Targets that Microcosm's catalog resolver and compiler build at 0ff293b,
  // each from two facts of loan type A (fixtures/mixed-groupby-storage), shown
  // on the page.
  const probeCell = (probe: { dashboard_target: Record<string, unknown> }) => {
    const row = {
      ...probe.dashboard_target,
      name: "combined-balance@2024",
      target_name: "combined-balance",
      target: 40,
      initial_estimate: 40,
      final_estimate: 40,
      relative_error: 0,
    };
    const [shown] = pageRows({ ...(edFsaFamily as Record<string, unknown>), targets: [row] }, "uk");
    return dimensionSummary(shown);
  };
  type Probe = { case: string; representative: string; dashboard_target: Record<string, unknown> };

  // One fact stores loan type A in its dimensions and the other in its
  // layout's group-by, and the hierarchy lists no loan type (review of
  // 67e6d0b, hierarchy_probe.py). The column claims no loan type varies,
  // whichever fact Microcosm picks as the representative: the resolver sorts
  // the facts by key and the compiler takes the last of the latest period
  // (ledger_targets.py:2178-2183, :1232-1245), so renaming the fact that stores
  // A in its dimensions from a-explicit to z-explicit makes it the
  // representative, and the target then carries no group-by pair (review of
  // 836fc66, producer.py).
  test("a target whose facts share an unlisted group-by value names no varying dimension", () => {
    const probes = hierarchyProbeTargets as Probe[];
    const [mixed, , , renamed] = probes;
    expect([mixed.representative, renamed.representative]).toEqual(["b-layout", "z-explicit"]);
    expect(probeCell(mixed)).toBe("Combines several source cells");
    expect(probeCell(renamed)).toBe("Combines several source cells");
  });

  // Both facts are female, so the hierarchy lists Female. One stores loan type
  // A in its dimensions and the other in its layout's group-by. Compiled once
  // with the layout fact as the representative, and once with the other
  // renamed z-explicit so that it is.
  test("a several-fact target reads its listed dimensions whichever fact represents it", () => {
    const probes = listedDimensionTargets as Probe[];
    expect(probes.map((probe) => probe.representative)).toEqual(["b-layout", "z-explicit"]);
    for (const probe of probes) {
      expect(probeCell(probe)).toBe("Female · Combines several source cells");
    }
  });

  // Both facts carry loan type A in their dimensions, so the hierarchy lists
  // it; the target still combines two facts.
  test("a several-fact target whose hierarchy lists its group-by value names it and combines several source cells", () => {
    const [, onlyRepresentative, conflicting] = hierarchyProbeTargets as Probe[];
    expect(probeCell(onlyRepresentative)).toBe("A · Combines several source cells");
    expect(probeCell(conflicting)).toBe("A · Combines several source cells");
  });

  // A ratio's operands raise a target's member count, but a rolled-forward or
  // allocated residual target with one base cell has that cell as its identity
  // (ledger_targets.py:1024-1031 at 0ff293b), so it names its state as the
  // cell does.
  test("a one-base ratio target reads as its base cell", () => {
    const fixture = edFsaFamily as Record<string, unknown>;
    const alabama = (fixture.targets as Record<string, unknown>[]).find((row) =>
      String(row.target_name).endsWith("portfolio_by_location.2026_03_31.al.dollars_outstanding"),
    );
    if (!alabama) throw new Error("No FSA Alabama balance.");
    const base = String((alabama.metadata as Record<string, unknown>).ledger_fact_key);
    const other = "ledger.aggregate_fact.v2:other_for_this_test";
    const cell = (operation: string, metadata: Record<string, string>) => {
      const row = structuredClone(alabama);
      const members = JSON.stringify([base, other, `${other}_2`]);
      Object.assign(row.metadata as Record<string, unknown>, {
        ledger_value_operation: operation,
        ledger_member_fact_count: "3",
        ledger_member_aggregate_fact_keys: members,
        ledger_member_fact_keys: members,
        ...metadata,
      });
      const [shown] = pageRows({ ...fixture, targets: [row] });
      return dimensionSummary(shown);
    };
    expect(
      cell("rolled_forward_by_ratio", {
        ledger_value_base_cells: "1",
        ledger_value_base_fact_keys: JSON.stringify([base]),
      }),
    ).toBe("Alabama");
    expect(
      cell("allocated_residual_by_ratio", {
        ledger_allocation_receipt: JSON.stringify({
          operation: "allocated_residual_by_ratio",
          version: 1,
          fact_keys: { base: [base], partition: [base, other], recipients: [other], total: `${other}_2` },
        }),
        ledger_aggregation_varying_dimensions: JSON.stringify(["ed_fsa.borrower_location"]),
      }),
    ).toBe("Alabama");
  });

  // A schema 6 release carries no hierarchy, so a several-fact target's
  // dimensions come from a recognized legacy filter when its filter has one,
  // and otherwise from its representative's metadata.
  test("a schema 6 several-fact target reads its legacy filter, else its representative's group-by", () => {
    const fixture = edFsaFamily as Record<string, unknown>;
    const target = (fixture.targets as Record<string, unknown>[]).find((row) =>
      String(row.target_name).endsWith("dollars_outstanding.excluding_parent_plus.dollars_outstanding"),
    );
    if (!target) throw new Error("No FSA balance excluding Parent PLUS.");
    const withoutHierarchy = structuredClone(target);
    delete withoutHierarchy.hierarchy;
    const cell = (filter: string | null) => {
      const [shown] = pageRows({
        ...fixture,
        schema_version: 6,
        targets: [{ ...withoutHierarchy, filter }],
      });
      return dimensionSummary(shown);
    };
    expect(cell("cell_be2_female_18_64")).toBe("Female · 18–64 · Combines several source cells");
    expect(cell(null)).toBe("stafford unsubsidized · Combines several source cells");
  });

  test("the dimensions its hierarchy lists come first, and no dimension is named as varying", () => {
    expect(
      dimensionSummary({
        target_dimensions: [{ key: "sex", label: "Sex", value: "Female" }],
        chronicle: {
          layout_groupby_dimension: "ed_fsa.borrower_age_band",
          layout_groupby_value_id: null,
          layout_groupby_unlisted_across_facts: true,
          identity_spans_several_facts: true,
          member_fact_count: 2,
        },
      }),
    ).toBe("Female · Combines several source cells");
  });

  test("a target whose group-by value reads all, or that has none, says All", () => {
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: "all" } })).toBe("All");
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: null } })).toBe("All");
    expect(dimensionSummary({})).toBe("All");
    // A ratio-scaled cell whose identity is one fact and that carries no
    // group-by pair reads as that fact does, though its ratio's operands raise
    // its member count.
    expect(
      dimensionSummary({
        chronicle: {
          layout_groupby_value_id: null,
          layout_groupby_unlisted_across_facts: null,
          identity_spans_several_facts: false,
          member_fact_count: 3,
        },
      }),
    ).toBe("All");
  });

  // Microcosm picks one fact as the representative (for a sum, by period and
  // then by fact key), and its group-by value, or its lack of one, says
  // nothing about the others.
  test("a several-fact target with no listed dimension combines several source cells, never All", () => {
    expect(
      dimensionSummary({
        chronicle: {
          layout_groupby_dimension: "ed_fsa.loan_type",
          layout_groupby_value_id: null,
          layout_groupby_unlisted_across_facts: null,
          identity_spans_several_facts: true,
          member_fact_count: 5,
        },
      }),
    ).toBe("Combines several source cells");
    // Nor does it name a group-by value its Chronicle fields show.
    expect(
      dimensionSummary({
        chronicle: {
          layout_groupby_value_id: "parent_plus",
          layout_groupby_unlisted_across_facts: false,
          identity_spans_several_facts: true,
          member_fact_count: 2,
        },
      }),
    ).toBe("Combines several source cells");
  });

  test("a single-fact target's group-by value names itself", () => {
    expect(dimensionSummary({ chronicle: { layout_groupby_value_id: "parent_plus" } }))
      .toBe("parent plus");
  });
});
