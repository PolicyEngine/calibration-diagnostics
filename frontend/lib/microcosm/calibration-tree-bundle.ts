import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import {
  CALIBRATION_TREE_SCHEMA_VERSION,
  calibrationTreePartPath,
  calibrationTreeTargetDetailsFromDraft,
  calibrationTreeTargetIndexFromDraft,
  calibrationTreeTiersFromDraft,
  compileCalibrationTreeBundleDraft,
  parseCalibrationTreeIndex,
  parseCalibrationTreePart,
  serializeCalibrationTreePart,
  type CalibrationTreeArtifactPartV2,
  type CalibrationTreeIndexArtifactV2,
  type CalibrationTreePart,
  type CalibrationTreePartDescriptor,
  type CalibrationTreeTierArtifactV2,
  type CalibrationTreeTierDescriptor,
  type CompileCalibrationTreeInput,
  type CompiledCalibrationLevel,
} from "./calibration-tree-artifact";
import { fitBandForTarget, type CalibrationTreeTarget } from "./calibration-tree";

export interface CalibrationTreeBundleFile {
  part: CalibrationTreePart;
  path: string;
  artifact: CalibrationTreeArtifactPartV2;
  serialized: string;
  sha256: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface CalibrationTreeBundle {
  index: CalibrationTreeIndexArtifactV2;
  files: CalibrationTreeBundleFile[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function describePart(artifact: CalibrationTreeArtifactPartV2): CalibrationTreeBundleFile {
  const serialized = serializeCalibrationTreePart(artifact);
  return {
    part: artifact.part,
    path: calibrationTreePartPath(
      artifact.country,
      artifact.hfCommitSha,
      artifact.part,
    ),
    artifact,
    serialized,
    sha256: sha256(serialized),
    rawBytes: Buffer.byteLength(serialized, "utf8"),
    gzipBytes: gzipSync(serialized, { level: 9 }).byteLength,
  };
}

function descriptor(file: CalibrationTreeBundleFile): CalibrationTreePartDescriptor {
  if (file.part === "index") throw new Error("The bundle index cannot describe itself.");
  return {
    part: file.part,
    path: file.path,
    sha256: file.sha256,
    rawBytes: file.rawBytes,
    gzipBytes: file.gzipBytes,
  };
}

export function buildCalibrationTreeBundle(
  input: CompileCalibrationTreeInput,
): CalibrationTreeBundle {
  const draft = compileCalibrationTreeBundleDraft(input);
  const targetIndexFile = describePart(calibrationTreeTargetIndexFromDraft(draft));
  const targetDetailsFile = describePart(calibrationTreeTargetDetailsFromDraft(draft));
  const tierFiles = calibrationTreeTiersFromDraft(draft).map(describePart);
  const rootLevels = Object.fromEntries(
    Object.entries(draft.levels).filter(
      ([levelId]) => draft.levelDepths[levelId] === 0,
    ),
  );
  const tierDescriptors = tierFiles.map((file, index): CalibrationTreeTierDescriptor => ({
    ...descriptor(file),
    part: file.part as `tier-${number}`,
    depth: index + 1,
    levelIds: Object.keys(
      (file.artifact as CalibrationTreeTierArtifactV2).levels,
    ).sort(),
  }));
  const index: CalibrationTreeIndexArtifactV2 = {
    schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
    country: draft.country,
    hfCommitSha: draft.release.hfCommitSha,
    part: "index",
    release: draft.release,
    calibrationProvenance: draft.calibrationProvenance,
    lossAttributionAvailable: draft.lossAttributionAvailable,
    filterOptions: draft.filterOptions,
    targetCount: draft.targets.length,
    maxDepth: tierFiles.length,
    roots: draft.roots,
    levels: rootLevels,
    parts: {
      tiers: tierDescriptors,
      targetIndex: {
        ...descriptor(targetIndexFile),
        part: "target-index",
      },
      targetDetails: {
        ...descriptor(targetDetailsFile),
        part: "target-details",
      },
    },
  };
  const indexFile = describePart(index);
  const bundle = {
    index,
    files: [targetDetailsFile, targetIndexFile, ...tierFiles, indexFile],
  };
  validateCalibrationTreeBundle(bundle);
  return bundle;
}

function sameIndices(left: number[], right: number[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function expectedFacet(row: CalibrationTreeTarget, key: string): string | null {
  if (key === "geographyLevels") return String(row.level ?? "").trim() || "national";
  if (key === "geographies") return String(row.geography ?? "").trim() || "United States";
  if (key === "fitBands") return fitBandForTarget(row);
  if (row.calibration_status === "included") return "included";
  if (row.calibration_status === "skipped" || row.calibration_status === "not_materialized") {
    return "skipped";
  }
  return null;
}

function validatePostingCoverage(
  bundle: CalibrationTreeBundle,
  targetIndexFile: CalibrationTreeBundleFile,
  targetDetailsFile: CalibrationTreeBundleFile,
): void {
  const targetIndex = targetIndexFile.artifact;
  const targetDetails = targetDetailsFile.artifact;
  if (targetIndex.part !== "target-index" || targetDetails.part !== "target-details") {
    throw new Error("Calibration tree target files have incorrect part identities.");
  }
  if (
    targetIndex.targets.length !== bundle.index.targetCount ||
    targetDetails.targets.length !== bundle.index.targetCount
  ) {
    throw new Error("Calibration tree target files do not match the declared target count.");
  }
  for (const key of [
    "geographyLevels",
    "geographies",
    "fitBands",
    "calibrationStatuses",
  ] as const) {
    const actual = new Map(
      targetIndex.postings[key].map((posting) => [posting.value, posting.targetIndices]),
    );
    const values = new Set(
      targetDetails.targets.map((row) => expectedFacet(row, key)),
    );
    if (actual.size !== values.size) {
      throw new Error(`Calibration tree ${key} postings do not cover every facet value.`);
    }
    for (const value of values) {
      const expected = targetDetails.targets.flatMap((row, index) =>
        expectedFacet(row, key) === value ? [index] : [],
      );
      if (!sameIndices(actual.get(value) ?? [], expected)) {
        throw new Error(`Calibration tree ${key} posting ${String(value)} is incorrect.`);
      }
    }
  }
}

function allLevels(bundle: CalibrationTreeBundle): Record<string, CompiledCalibrationLevel> {
  return Object.assign(
    {},
    bundle.index.levels,
    ...bundle.files.flatMap((file) =>
      file.artifact.part.startsWith("tier-")
        ? [(file.artifact as CalibrationTreeTierArtifactV2).levels]
        : [],
    ),
  );
}

function validateGraph(bundle: CalibrationTreeBundle): void {
  const levels = allLevels(bundle);
  const expectedTargetIndices = Array.from(
    { length: bundle.index.targetCount },
    (_, index) => index,
  );
  for (const rootName of ["program", "geography"] as const) {
    const root = levels[bundle.index.roots[rootName]];
    if (!root || !sameIndices(root.targetIndices, expectedTargetIndices)) {
      throw new Error(`Calibration tree ${rootName} root does not cover every target.`);
    }
  }

  const depths = new Map<string, number>();
  const queue = [
    { levelId: bundle.index.roots.program, depth: 0 },
    { levelId: bundle.index.roots.geography, depth: 0 },
  ];
  while (queue.length) {
    const { levelId, depth } = queue.shift()!;
    const previousDepth = depths.get(levelId);
    if (previousDepth != null) {
      if (previousDepth !== depth) {
        throw new Error(`Calibration tree level ${levelId} appears at multiple depths.`);
      }
      continue;
    }
    const level = levels[levelId];
    if (!level) throw new Error(`Calibration tree level ${levelId} is missing.`);
    depths.set(levelId, depth);
    for (const node of level.groups.flatMap((group) => group.nodes)) {
      if (node.kind === "target") continue;
      const child = levels[node.nextLevelId];
      if (!child) throw new Error(`Calibration tree level ${node.nextLevelId} is missing.`);
      if (!sameIndices(node.targetIndices, child.targetIndices)) {
        throw new Error(`Calibration tree branch ${node.id} has inconsistent membership.`);
      }
      queue.push({ levelId: node.nextLevelId, depth: depth + 1 });
    }
  }
  if (depths.size !== Object.keys(levels).length) {
    throw new Error("Calibration tree contains an unreachable level.");
  }

  const expectedDepths = new Map<string, number>();
  Object.keys(bundle.index.levels).forEach((levelId) => expectedDepths.set(levelId, 0));
  for (const descriptor of bundle.index.parts.tiers) {
    descriptor.levelIds.forEach((levelId) => expectedDepths.set(levelId, descriptor.depth));
  }
  if (expectedDepths.size !== Object.keys(levels).length) {
    throw new Error("Calibration tree tier descriptors omit or duplicate levels.");
  }
  for (const [levelId, depth] of depths) {
    if (expectedDepths.get(levelId) !== depth) {
      throw new Error(`Calibration tree level ${levelId} is stored in the wrong tier.`);
    }
  }
}

export function validateCalibrationTreeBundle(bundle: CalibrationTreeBundle): void {
  parseCalibrationTreeIndex(bundle.index);
  const expectedParts: CalibrationTreePart[] = [
    "target-details",
    "target-index",
    ...bundle.index.parts.tiers.map((tier) => tier.part),
    "index",
  ];
  if (
    bundle.files.length !== expectedParts.length ||
    bundle.files.some((file, index) => file.part !== expectedParts[index])
  ) {
    throw new Error("Calibration tree bundle has missing, additional, or misordered files.");
  }
  const seenPaths = new Set<string>();
  for (const file of bundle.files) {
    if (seenPaths.has(file.path)) {
      throw new Error(`Calibration tree bundle repeats ${file.path}.`);
    }
    seenPaths.add(file.path);
    const expectedPath = calibrationTreePartPath(
      bundle.index.country,
      bundle.index.hfCommitSha,
      file.part,
    );
    if (file.path !== expectedPath) {
      throw new Error(`Calibration tree part ${file.part} has the wrong path.`);
    }
    if (serializeCalibrationTreePart(file.artifact) !== file.serialized) {
      throw new Error(`Calibration tree part ${file.part} artifact and bytes differ.`);
    }
    const parsed = parseCalibrationTreePart(JSON.parse(file.serialized), file.part);
    if (
      parsed.country !== bundle.index.country ||
      parsed.hfCommitSha !== bundle.index.hfCommitSha
    ) {
      throw new Error(`Calibration tree part ${file.part} has inconsistent identity.`);
    }
    if (
      sha256(file.serialized) !== file.sha256 ||
      Buffer.byteLength(file.serialized, "utf8") !== file.rawBytes ||
      gzipSync(file.serialized, { level: 9 }).byteLength !== file.gzipBytes
    ) {
      throw new Error(`Calibration tree part ${file.part} has incorrect content metadata.`);
    }
  }
  const fileByPart = new Map(bundle.files.map((file) => [file.part, file]));
  if (serializeCalibrationTreePart(bundle.index) !== fileByPart.get("index")?.serialized) {
    throw new Error("Calibration tree bundle index does not match index.json.");
  }
  for (const partDescriptor of [
    ...bundle.index.parts.tiers,
    bundle.index.parts.targetIndex,
    bundle.index.parts.targetDetails,
  ]) {
    const file = fileByPart.get(partDescriptor.part);
    if (
      !file ||
      file.path !== partDescriptor.path ||
      file.sha256 !== partDescriptor.sha256 ||
      file.rawBytes !== partDescriptor.rawBytes ||
      file.gzipBytes !== partDescriptor.gzipBytes
    ) {
      throw new Error(`Calibration tree descriptor ${partDescriptor.part} is incorrect.`);
    }
  }
  const targetIndexFile = fileByPart.get("target-index")!;
  const targetDetailsFile = fileByPart.get("target-details")!;
  validatePostingCoverage(bundle, targetIndexFile, targetDetailsFile);
  validateGraph(bundle);
}

export function calibrationTreeBundleFile(
  bundle: CalibrationTreeBundle,
  part: CalibrationTreePart,
): CalibrationTreeBundleFile {
  const file = bundle.files.find((candidate) => candidate.part === part);
  if (!file) throw new Error(`Calibration tree bundle is missing ${part}.`);
  return file;
}
