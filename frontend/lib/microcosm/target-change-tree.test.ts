import { describe, expect, test } from "bun:test";

import {
  createExplorerState,
  type ExplorerState,
} from "./calibration-explorer";
import type { Calibration } from "./latest-artifact";
import { buildTargetChangeDataset } from "./target-change";
import { buildTargetChangeTree } from "./target-change-tree";

interface RowInput {
  name: string;
  contribution: number;
  share: number;
  error: number;
  source?: string;
  variable?: string;
  geography?: string;
}

function calibration(releaseId: string, rows: RowInput[]): Calibration {
  const aggregate = rows.reduce((sum, row) => sum + row.contribution, 0);
  return {
    release_id: releaseId,
    rows: rows.map((row) => ({
      name: `${row.name}@2024`,
      base_name: row.name,
      source: row.source ?? "tax",
      variable: row.variable ?? "benefits",
      variable_key: row.variable ?? "benefits",
      geography: row.geography ?? "United States",
      level: row.geography ? "state" : "national",
      target: 100,
      final_estimate: 100 + row.error * 100,
      target_loss_weight: row.share * 100,
      target_loss_weight_share: row.share,
      target_loss_scale: 100,
      final_capped_scaled_error: row.error,
      final_loss_contribution: row.contribution,
    })),
    target_loss_attribution: {
      status: "reported",
      aggregate,
      historical_final_loss: aggregate,
      cap: 2,
      basis_identifier: "sqrt:target",
      basis_hash: "hash",
      verification: null,
      producer_warnings: [],
      reason: null,
      targets: [],
    },
  } as unknown as Calibration;
}

function fixture() {
  return buildTargetChangeDataset(
    calibration("current", [
      { name: "one", contribution: 0.1, share: 0.4, error: 0.25, geography: "CA" },
      { name: "two", contribution: 0.2, share: 0.4, error: 0.5, geography: "NY" },
      { name: "removed", contribution: 0.05, share: 0.2, error: 0.25, variable: "income", geography: "CA" },
    ]),
    calibration("candidate", [
      { name: "one", contribution: 0.2, share: 0.5, error: 0.4, geography: "CA" },
      { name: "two", contribution: 0.1, share: 0.25, error: 0.4, geography: "NY" },
      { name: "added", contribution: 0.05, share: 0.25, error: 0.2, variable: "income", geography: "TX" },
    ]),
  );
}

function programState(): ExplorerState {
  const state = createExplorerState();
  state.path = {
    source: "tax",
    program: "benefits",
    dimensions: [],
  };
  return state;
}

describe("target change hierarchy", () => {
  test("keeps increases and reductions separate inside a net-zero category", () => {
    const tree = buildTargetChangeTree(fixture(), createExplorerState(), "reported");
    const benefits = tree.groups
      .flatMap((group) => group.nodes)
      .find((node) => node.id === "benefits");
    expect(benefits?.metrics.change).toEqual(expect.objectContaining({
      increasedError: 0.1,
      reducedError: 0.1,
      netChange: 0,
      changedTargets: 2,
    }));
    expect(tree.filteredMetrics.change?.increasedError).toBeCloseTo(0.15);
    expect(tree.filteredMetrics.change?.reducedError).toBeCloseTo(0.15);
  });

  test("supports geography-first and program-first drill-down", () => {
    const geographyState = createExplorerState();
    geographyState.breakdown = "geography";
    const geographyTree = buildTargetChangeTree(fixture(), geographyState, "reported");
    expect(geographyTree.groups[0].nodes.map((node) => node.id).sort()).toEqual([
      "CA",
      "NY",
      "TX",
    ]);

    const programTree = buildTargetChangeTree(fixture(), programState(), "reported");
    expect(programTree.currentLevel.kind).toBe("geography");
    expect(programTree.groups[0].nodes.map((node) => node.id).sort()).toEqual([
      "CA",
      "NY",
    ]);
  });

  test("returns selected compact target detail at the target level", () => {
    const dataset = fixture();
    const state = programState();
    state.path.geography = "CA";
    state.path.target = dataset.rows.find((row) => row.name === "one")?.comparison_id;
    const tree = buildTargetChangeTree(dataset, state, "reported");
    expect(tree.currentLevel.kind).toBe("target");
    expect(tree.selectedTarget).toEqual(expect.objectContaining({
      name: "one",
      comparison_status: "shared",
      reported_change: 0.1,
    }));
    expect(tree.selectedTarget?.current).toEqual(expect.objectContaining({
      contribution: 0.1,
    }));
    expect(tree.selectedTarget?.candidate).toEqual(expect.objectContaining({
      contribution: 0.2,
    }));
  });

  test("selects a shared target whose release identifiers differ", () => {
    const current = calibration("current", [
      { name: "old-name", contribution: 0.1, share: 1, error: 0.1 },
    ]);
    const candidate = calibration("candidate", [
      { name: "new-name", contribution: 0.2, share: 1, error: 0.2 },
    ]);
    current.rows[0].chronicle = { fact_key: "agency.population.total" };
    candidate.rows[0].chronicle = { fact_key: "agency.population.total" };
    const dataset = buildTargetChangeDataset(current, candidate);
    const state = programState();
    state.path.geography = "United States";
    state.path.target = dataset.rows[0].comparison_id;

    const tree = buildTargetChangeTree(dataset, state, "reported");
    expect(tree.selectedTarget).toMatchObject({
      current_name: "old-name@2024",
      candidate_name: "new-name@2024",
      match_kind: "chronicle_fact_key",
    });
    expect(tree.groups.flatMap((group) => group.nodes)[0]?.id).toBe(
      dataset.rows[0].comparison_id,
    );
  });

  test("shared mode excludes added and removed target leaves", () => {
    const tree = buildTargetChangeTree(fixture(), createExplorerState(), "shared");
    expect(tree.summary?.comparisonTargets).toBe(2);
    expect(tree.filteredMetrics.change?.addedTargets).toBe(0);
    expect(tree.filteredMetrics.change?.removedTargets).toBe(0);
    expect(tree.filteredMetrics.change?.sharedTargets).toBe(2);
  });
});
