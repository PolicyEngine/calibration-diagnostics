import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import {
  calibrationTreeTargetDetailsFromDraft,
  calibrationTreeResponseFromBundle,
  calibrationTreeTargetDetailSelection,
  compileCalibrationTreeBundleDraft,
  parseCalibrationTreeIndex,
  parseCalibrationTreePart,
  serializeCalibrationTreePart,
  type CalibrationTreeTargetDetailsArtifact,
  type CalibrationTreeTargetIndexArtifact,
  type CalibrationTreeTierArtifact,
} from "./calibration-tree-artifact";
import {
  buildCalibrationTreeBundle,
  validateCalibrationTreeBundle,
  type CalibrationTreeBundle,
} from "./calibration-tree-bundle";
import {
  createExplorerState,
  selectExplorerNode,
  type ExplorerState,
} from "./calibration-explorer";
import {
  buildCalibrationTree,
  type CalibrationTreeTarget,
} from "./calibration-tree";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const SOURCE_HASH = "a".repeat(64);
const RELEASE = "microcosm-us-test-20260915";

const rows: CalibrationTreeTarget[] = [
  ["snap-total", "United States", "national", "All", 0.02, "included"],
  ["snap-ca-children", "California", "state", "Children", 0.12, "included"],
  ["snap-ca-adults", "California", "state", "Adults", 0.3, "not_materialized"],
  ["ctc-total", "United States", "national", "All", 0.04, "included"],
].map(([id, geography, level, householdType, error, status]) => ({
  comparison_id: id as string,
  name: id as string,
  target_label: id as string,
  target_representation: "hierarchy",
  source: "chronicle",
  source_label: "Chronicle",
  variable: String(id).startsWith("ctc") ? "ctc" : "snap",
  variable_label: String(id).startsWith("ctc") ? "Child Tax Credit" : "SNAP",
  geography: geography as string,
  level: level as string,
  abs_relative_error: error as number,
  final_loss_contribution: (error as number) / 10,
  target_loss_weight_share: 0.25,
  calibration_status: status as "included" | "not_materialized",
  target_dimensions: householdType === "All"
    ? []
    : [{
        key: "household_type",
        label: "Household type",
        value: householdType as string,
        value_id: String(householdType).toLowerCase(),
      }],
}));

function bundle(): CalibrationTreeBundle {
  return buildCalibrationTreeBundle({
    country: "us",
    releaseId: RELEASE,
    hfRepo: "policyengine/populace-us",
    hfCommitSha: COMMIT,
    sourceArtifacts: {
      calibrationDiagnostics: {
        path: `releases/${RELEASE}/calibration_diagnostics.json`,
        sha256: SOURCE_HASH,
      },
      buildManifest: null,
      releaseManifest: null,
      demographics: null,
    },
    rows,
    lossAttributionAvailable: true,
  });
}

function loaded(built = bundle()) {
  return {
    index: built.index,
    tiers: built.files.flatMap((file) =>
      file.part.startsWith("tier-")
        ? [file.artifact as CalibrationTreeTierArtifact]
        : [],
    ),
    targetIndex: built.files.find((file) => file.part === "target-index")!
      .artifact as CalibrationTreeTargetIndexArtifact,
    targetDetailShard: built.files.find((file) =>
      file.part.startsWith("target-details-"),
    )!
      .artifact as CalibrationTreeTargetDetailsArtifact,
  };
}

test("partitioned bundle returns the same response at every navigable tree level", () => {
  const compiled = loaded();
  const queue: ExplorerState[] = [
    createExplorerState(),
    { ...createExplorerState(), breakdown: "geography" },
  ];
  const visited = new Set<string>();

  while (queue.length) {
    const state = queue.shift()!;
    const key = JSON.stringify({ breakdown: state.breakdown, path: state.path });
    if (visited.has(key)) continue;
    visited.add(key);
    const direct = buildCalibrationTree(rows, state, RELEASE, true);
    expect(calibrationTreeResponseFromBundle(compiled, state)).toEqual(direct);
    for (const node of direct.groups.flatMap((group) => group.nodes)) {
      if (node.kind !== "target") queue.push(selectExplorerNode(state, node.selection));
    }
  }

  expect(visited.size).toBeGreaterThan(4);
});

test("posting-list filters union within categories and intersect across them", () => {
  const state: ExplorerState = {
    ...createExplorerState(),
    filters: {
      geographyLevels: ["state"],
      geographies: ["California", "New York"],
      fitBands: ["10_20", "20_40"],
      comparisonFits: [],
      calibrationStatuses: ["included"],
    },
  };
  expect(calibrationTreeResponseFromBundle(loaded(), state)).toEqual(
    buildCalibrationTree(rows, state, RELEASE, true),
  );
});

test("the index renders without later parts and deeper navigation waits for its tier", () => {
  const built = bundle();
  const root = calibrationTreeResponseFromBundle(
    { index: built.index, tiers: [] },
    createExplorerState(),
  );
  expect(root?.currentLevel.kind).toBe("overview");
  const program = root!.groups.flatMap((group) => group.nodes)
    .find((node) => node.kind === "program")!;
  const childState = selectExplorerNode(createExplorerState(), program.selection);
  expect(calibrationTreeResponseFromBundle(
    { index: built.index, tiers: [] },
    childState,
  )).toBeNull();
});

test("bundle serialization and folder paths are deterministic", async () => {
  const first = bundle();
  const second = bundle();
  expect(second.files.map((file) => file.serialized)).toEqual(
    first.files.map((file) => file.serialized),
  );
  const buildArtifactId = first.index.buildArtifactId;
  expect(first.files.map((file) => file.path)).toEqual([
    `calibration-trees/us/${buildArtifactId}/target-details-0001.json`,
    `calibration-trees/us/${buildArtifactId}/target-index.json`,
    ...first.index.parts.tiers.map((_, index) =>
      `calibration-trees/us/${buildArtifactId}/tier-${index + 1}.json`,
    ),
    `calibration-trees/us/${buildArtifactId}/index.json`,
  ]);

  const directory = await mkdtemp(join(tmpdir(), "calibration-tree-bundle-"));
  try {
    for (const file of first.files) {
      const destination = join(directory, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.serialized, "utf8");
    }
    const materialized = first.files.map((file) =>
      relative(directory, join(directory, file.path)),
    );
    expect(materialized).toEqual(first.files.map((file) => file.path));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("target details use deterministic shards and explicit locations", () => {
  const input = {
    country: "us" as const,
    releaseId: RELEASE,
    hfRepo: "policyengine/populace-us",
    hfCommitSha: COMMIT,
    sourceArtifacts: {
      calibrationDiagnostics: {
        path: `releases/${RELEASE}/calibration_diagnostics.json`,
        sha256: SOURCE_HASH,
      },
      buildManifest: null,
      releaseManifest: null,
      demographics: null,
    },
    rows,
    lossAttributionAvailable: true,
  };
  const draft = compileCalibrationTreeBundleDraft(input);
  const first = calibrationTreeTargetDetailsFromDraft(draft, 1_000);
  const second = calibrationTreeTargetDetailsFromDraft(draft, 1_000);

  expect(first.artifacts.length).toBeGreaterThan(1);
  expect(first).toEqual(second);
  expect(first.artifacts.map((artifact) => artifact.part)).toEqual(
    first.artifacts.map((_, index) =>
      `target-details-${String(index + 1).padStart(4, "0")}` as const,
    ),
  );
  first.locations.forEach((location, targetOrdinal) => {
    const shard = first.artifacts[location.shardIndex];
    expect(shard.startTargetOrdinal + location.offset).toBe(targetOrdinal);
    expect(shard.targets[location.offset]).toEqual(draft.targets[targetOrdinal].detail);
  });
});

test("target-detail shard limits use exact UTF-8 bytes", () => {
  const unicodeRows = [{
    ...rows[0],
    comparison_id: "unicode-target",
    name: "unicode-target",
    target_label: "Café 🌍",
    description: "é🌍".repeat(50),
  }];
  const draft = compileCalibrationTreeBundleDraft({
    country: "us",
    releaseId: RELEASE,
    hfRepo: "policyengine/populace-us",
    hfCommitSha: COMMIT,
    sourceArtifacts: {
      calibrationDiagnostics: {
        path: `releases/${RELEASE}/calibration_diagnostics.json`,
        sha256: SOURCE_HASH,
      },
      buildManifest: null,
      releaseManifest: null,
      demographics: null,
    },
    rows: unicodeRows,
    lossAttributionAvailable: true,
  });
  const initial = calibrationTreeTargetDetailsFromDraft(draft, 10_000);
  const serialized = serializeCalibrationTreePart(initial.artifacts[0]);
  const exactBytes = Buffer.byteLength(serialized, "utf8");
  expect(exactBytes).toBeGreaterThan(serialized.length);
  expect(calibrationTreeTargetDetailsFromDraft(draft, exactBytes).artifacts).toHaveLength(1);
  expect(() => calibrationTreeTargetDetailsFromDraft(draft, exactBytes - 1)).toThrow(
    "exceeds",
  );
});

test("calibration tree schema 3 artifacts are rejected", () => {
  const legacy = structuredClone(bundle().index) as unknown as Record<string, unknown>;
  legacy.schemaVersion = 3;
  expect(() => parseCalibrationTreeIndex(legacy)).toThrow(
    "Unsupported calibration tree schema 3",
  );
});

test("target detail selection resolves explicit shard locations", () => {
  const built = bundle();
  const targetIndex = built.files.find((file) => file.part === "target-index")!
    .artifact as CalibrationTreeTargetIndexArtifact;
  targetIndex.targets.forEach((target, targetOrdinal) => {
    const selection = calibrationTreeTargetDetailSelection(
      built.index,
      target,
      targetOrdinal,
    );
    expect(selection.descriptor.part).toBe(
      built.index.parts.targetDetails[target.detailLocation.shardIndex].part,
    );
    expect(selection.offset).toBe(target.detailLocation.offset);
  });

  const corrupt = structuredClone(targetIndex.targets[0]);
  corrupt.detailLocation.offset += 1;
  expect(() => calibrationTreeTargetDetailSelection(built.index, corrupt, 0)).toThrow(
    "invalid detail location",
  );
});

test("bundle validation rejects corrupt metadata and postings", () => {
  const built = bundle();
  const corruptPath = structuredClone(built);
  corruptPath.index.parts.tiers[0].path = "calibration-trees/v2/bad.json";
  expect(() => validateCalibrationTreeBundle(corruptPath)).toThrow("wrong path");

  const targetIndexFile = built.files.find((file) => file.part === "target-index")!;
  const parsed = parseCalibrationTreePart(
    JSON.parse(targetIndexFile.serialized),
    "target-index",
  ) as CalibrationTreeTargetIndexArtifact;
  parsed.postings.geographies[0].targetOrdinals = [];
  const corruptPosting = structuredClone(built);
  const corruptFile = corruptPosting.files.find((file) => file.part === "target-index")!;
  corruptFile.artifact = parsed;
  corruptFile.serialized = `${JSON.stringify(parsed)}\n`;
  expect(() => validateCalibrationTreeBundle(corruptPosting)).toThrow();

  const corruptLocation = structuredClone(built);
  const corruptTargetIndex = corruptLocation.files.find(
    (file) => file.part === "target-index",
  )!;
  if (corruptTargetIndex.artifact.part !== "target-index") throw new Error("bad fixture");
  corruptTargetIndex.artifact.targets[0].detailLocation.offset += 1;
  expect(() => validateCalibrationTreeBundle(corruptLocation)).toThrow();
});
