import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import {
  CALIBRATION_TREE_SCHEMA_VERSION,
  CALIBRATION_TREE_TARGET_DETAIL_MAX_RAW_BYTES,
  calibrationTreePartPath,
  calibrationTreeTargetDetailsFromDraft,
  calibrationTreeTargetIndexFromDraft,
  calibrationTreeTiersFromDraft,
  compileCalibrationTreeBundleDraft,
  parseCalibrationTreeIndex,
  parseCalibrationTreePart,
  serializeCalibrationTreePart,
  type CalibrationTreeArtifactPart,
  type CalibrationTreeIndexArtifact,
  type CalibrationTreePart,
  type CalibrationTreePartDescriptor,
  type CalibrationTreeTargetDetailsArtifact,
  type CalibrationTreeTargetDetailsDescriptor,
  type CalibrationTreeTierArtifact,
  type CalibrationTreeTierDescriptor,
  type CompileCalibrationTreeInput,
  type CompiledCalibrationLevel,
} from "./calibration-tree-artifact";
import { fitBandForTarget, type CalibrationTreeTarget } from "./calibration-tree";

export interface CalibrationTreeBundleFile {
  part: CalibrationTreePart;
  path: string;
  artifact: CalibrationTreeArtifactPart;
  serialized: string;
  sha256: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface CalibrationTreeBundle {
  index: CalibrationTreeIndexArtifact;
  files: CalibrationTreeBundleFile[];
}

export function calibrationTreeBuildArtifactId(
  input: CompileCalibrationTreeInput,
): string {
  const sourceHashes = Object.fromEntries(
    Object.entries(input.sourceArtifacts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, artifact]) => [name, artifact?.sha256 ?? null]),
  );
  return sha256(JSON.stringify({
    schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
    country: input.country,
    kind: input.buildKind ?? "release",
    sourceId: input.sourceId ?? input.releaseId,
    sourceHashes,
  }));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function describePart(artifact: CalibrationTreeArtifactPart): CalibrationTreeBundleFile {
  const serialized = serializeCalibrationTreePart(artifact);
  return {
    part: artifact.part,
    path: calibrationTreePartPath(
      artifact.country,
      artifact.buildArtifactId,
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
  const draft = compileCalibrationTreeBundleDraft({
    ...input,
    buildArtifactId:
      input.buildArtifactId ?? calibrationTreeBuildArtifactId(input),
  });
  const targetDetails = calibrationTreeTargetDetailsFromDraft(draft);
  const targetDetailsFiles = targetDetails.artifacts.map(describePart);
  const targetIndexFile = describePart(
    calibrationTreeTargetIndexFromDraft(draft, targetDetails.locations),
  );
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
      (file.artifact as CalibrationTreeTierArtifact).levels,
    ).sort(),
  }));
  const index: CalibrationTreeIndexArtifact = {
    schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
    country: draft.country,
    buildArtifactId: draft.build.buildArtifactId,
    part: "index",
    build: draft.build,
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
      targetDetails: targetDetailsFiles.map((file, shardIndex) => ({
        ...descriptor(file),
        part: file.part as CalibrationTreeTargetDetailsDescriptor["part"],
        startTargetOrdinal: targetDetails.artifacts[shardIndex].startTargetOrdinal,
        endTargetOrdinalExclusive:
          targetDetails.artifacts[shardIndex].endTargetOrdinalExclusive,
      })),
    },
  };
  const indexFile = describePart(index);
  const bundle = {
    index,
    files: [...targetDetailsFiles, targetIndexFile, ...tierFiles, indexFile],
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
  targetDetailsFiles: CalibrationTreeBundleFile[],
): void {
  const targetIndex = targetIndexFile.artifact;
  const targetDetails = targetDetailsFiles.map((file) => file.artifact);
  if (
    targetIndex.part !== "target-index" ||
    targetDetails.some((artifact) => !artifact.part.startsWith("target-details-"))
  ) {
    throw new Error("Calibration tree target files have incorrect part identities.");
  }
  const detailRows = targetDetails.flatMap(
    (artifact) => (artifact as CalibrationTreeTargetDetailsArtifact).targets,
  );
  if (
    targetIndex.targets.length !== bundle.index.targetCount ||
    detailRows.length !== bundle.index.targetCount
  ) {
    throw new Error("Calibration tree target files do not match the declared target count.");
  }
  targetIndex.targets.forEach((target, targetOrdinal) => {
    const descriptor = bundle.index.parts.targetDetails[target.detailLocation.shardIndex];
    const file = descriptor ? targetDetailsFiles[target.detailLocation.shardIndex] : undefined;
    if (
      !descriptor ||
      !file ||
      file.part !== descriptor.part ||
      descriptor.startTargetOrdinal + target.detailLocation.offset !== targetOrdinal ||
      target.detailLocation.offset >=
        descriptor.endTargetOrdinalExclusive - descriptor.startTargetOrdinal
    ) {
      throw new Error(`Calibration target ordinal ${targetOrdinal} has an invalid detail location.`);
    }
  });
  for (const key of [
    "geographyLevels",
    "geographies",
    "fitBands",
    "calibrationStatuses",
  ] as const) {
    const actual = new Map(
      targetIndex.postings[key].map((posting) => [posting.value, posting.targetOrdinals]),
    );
    const values = new Set(
      detailRows.map((row) => expectedFacet(row, key)),
    );
    if (actual.size !== values.size) {
      throw new Error(`Calibration tree ${key} postings do not cover every facet value.`);
    }
    for (const value of values) {
      const expected = detailRows.flatMap((row, targetOrdinal) =>
        expectedFacet(row, key) === value ? [targetOrdinal] : [],
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
        ? [(file.artifact as CalibrationTreeTierArtifact).levels]
        : [],
    ),
  );
}

function validateGraph(bundle: CalibrationTreeBundle): void {
  const levels = allLevels(bundle);
  const expectedTargetOrdinals = Array.from(
    { length: bundle.index.targetCount },
    (_, targetOrdinal) => targetOrdinal,
  );
  for (const rootName of ["program", "geography"] as const) {
    const root = levels[bundle.index.roots[rootName]];
    if (!root || !sameIndices(root.targetOrdinals, expectedTargetOrdinals)) {
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
      if (!sameIndices(node.targetOrdinals, child.targetOrdinals)) {
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
    ...bundle.index.parts.targetDetails.map((descriptor) => descriptor.part),
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
      bundle.index.buildArtifactId,
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
      parsed.buildArtifactId !== bundle.index.buildArtifactId
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
    if (
      file.part.startsWith("target-details-") &&
      file.rawBytes > CALIBRATION_TREE_TARGET_DETAIL_MAX_RAW_BYTES
    ) {
      throw new Error(`Calibration tree part ${file.part} exceeds the target-detail limit.`);
    }
  }
  const fileByPart = new Map(bundle.files.map((file) => [file.part, file]));
  if (serializeCalibrationTreePart(bundle.index) !== fileByPart.get("index")?.serialized) {
    throw new Error("Calibration tree bundle index does not match index.json.");
  }
  for (const partDescriptor of [
    ...bundle.index.parts.tiers,
    bundle.index.parts.targetIndex,
    ...bundle.index.parts.targetDetails,
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
    if (partDescriptor.part.startsWith("target-details-")) {
      const artifact = file.artifact as CalibrationTreeTargetDetailsArtifact;
      const detailDescriptor = partDescriptor as CalibrationTreeTargetDetailsDescriptor;
      if (
        artifact.startTargetOrdinal !== detailDescriptor.startTargetOrdinal ||
        artifact.endTargetOrdinalExclusive !== detailDescriptor.endTargetOrdinalExclusive
      ) {
        throw new Error(
          `Calibration tree descriptor ${partDescriptor.part} has an inconsistent target range.`,
        );
      }
    }
  }
  const targetIndexFile = fileByPart.get("target-index")!;
  const targetDetailsFiles = bundle.index.parts.targetDetails.map(
    (descriptor) => fileByPart.get(descriptor.part)!,
  );
  validatePostingCoverage(bundle, targetIndexFile, targetDetailsFiles);
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
