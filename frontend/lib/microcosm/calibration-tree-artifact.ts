import {
  buildCalibrationTree,
  calibrationTreeMetricsFromInputs,
  fitBandForTarget,
  normalizeCalibrationTreeTargets,
  type CalibrationTreeGroup,
  type CalibrationTreeMetricInput,
  type CalibrationTreeMetrics,
  type CalibrationTreeNode,
  type CalibrationTreeResponse,
  type CalibrationTreeTarget,
} from "./calibration-tree";
import {
  createExplorerState,
  selectExplorerNode,
  type CalibrationStatus,
  type ExplorerNodeSelection,
  type ExplorerState,
  type FitBand,
} from "./calibration-explorer";
import { isCountry, type MicrocosmCountry } from "./countries";
import type { CalibrationProvenance } from "./target-loss-attribution";

export const CALIBRATION_TREE_SCHEMA_VERSION = 3 as const;
export const CALIBRATION_TREE_TARGET_DETAIL_MAX_RAW_BYTES = 4_000_000;

export type CalibrationTreeTierPart = `tier-${number}`;
export type CalibrationTreeTargetDetailsPart = `target-details-${string}`;
export type CalibrationTreePart =
  | "index"
  | CalibrationTreeTierPart
  | "target-index"
  | CalibrationTreeTargetDetailsPart;

export interface CalibrationTreeSourceArtifact {
  path: string;
  sha256: string;
}

export interface CalibrationTreeSourceArtifacts {
  calibrationDiagnostics: CalibrationTreeSourceArtifact;
  buildManifest: CalibrationTreeSourceArtifact | null;
  releaseManifest: CalibrationTreeSourceArtifact | null;
  demographics: CalibrationTreeSourceArtifact | null;
}

export interface CalibrationTreeRelease {
  releaseId: string;
  hfRepo: string;
  hfCommitSha: string;
  sourceArtifacts: CalibrationTreeSourceArtifacts;
}

export interface IndexedCalibrationTarget {
  id: string;
  label: string;
  metricInputs: CalibrationTreeMetricInput;
  detailLocation: {
    shardIndex: number;
    offset: number;
  };
}

export interface CalibrationTreePosting<T extends string | null = string> {
  value: T;
  targetOrdinals: number[];
}

export interface CalibrationTreeFilterPostings {
  geographyLevels: CalibrationTreePosting[];
  geographies: CalibrationTreePosting[];
  fitBands: CalibrationTreePosting<FitBand>[];
  comparisonFits: CalibrationTreePosting[];
  calibrationStatuses: CalibrationTreePosting<CalibrationStatus | null>[];
}

interface CompiledCalibrationNodeBase {
  id: string;
  label: string;
  selection: ExplorerNodeSelection;
  targetOrdinals: number[];
  metrics: CalibrationTreeMetrics;
  authoredLabel?: boolean;
}

export interface CompiledCalibrationBranchNode
  extends CompiledCalibrationNodeBase {
  kind: Exclude<ExplorerNodeSelection["kind"], "target">;
  nextLevelId: string;
}

export interface CompiledCalibrationTargetNode
  extends CompiledCalibrationNodeBase {
  kind: "target";
  targetOrdinal: number;
}

export type CompiledCalibrationNode =
  | CompiledCalibrationBranchNode
  | CompiledCalibrationTargetNode;

export interface CompiledCalibrationGroup {
  id: string;
  label: string;
  targetOrdinals: number[];
  metrics: CalibrationTreeMetrics;
  nodes: CompiledCalibrationNode[];
}

export interface CompiledCalibrationLevel {
  currentLevel: CalibrationTreeResponse["currentLevel"];
  pathLabels: CalibrationTreeResponse["pathLabels"];
  dimensionOrder: CalibrationTreeResponse["dimensionOrder"];
  targetOrdinals: number[];
  metrics: CalibrationTreeMetrics;
  groups: CompiledCalibrationGroup[];
}

interface CalibrationTreePartIdentity {
  schemaVersion: typeof CALIBRATION_TREE_SCHEMA_VERSION;
  country: MicrocosmCountry;
  hfCommitSha: string;
  part: CalibrationTreePart;
}

export interface CalibrationTreePartDescriptor {
  part: Exclude<CalibrationTreePart, "index">;
  path: string;
  sha256: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface CalibrationTreeTierDescriptor
  extends CalibrationTreePartDescriptor {
  part: CalibrationTreeTierPart;
  depth: number;
  levelIds: string[];
}

export interface CalibrationTreeTargetDetailsDescriptor
  extends CalibrationTreePartDescriptor {
  part: CalibrationTreeTargetDetailsPart;
  startTargetOrdinal: number;
  endTargetOrdinalExclusive: number;
}

export interface CalibrationTreeIndexArtifact
  extends CalibrationTreePartIdentity {
  part: "index";
  release: CalibrationTreeRelease;
  calibrationProvenance?: CalibrationProvenance;
  lossAttributionAvailable: boolean;
  filterOptions: CalibrationTreeResponse["filterOptions"];
  targetCount: number;
  maxDepth: number;
  roots: {
    program: string;
    geography: string;
  };
  levels: Record<string, CompiledCalibrationLevel>;
  parts: {
    tiers: CalibrationTreeTierDescriptor[];
    targetIndex: CalibrationTreePartDescriptor & { part: "target-index" };
    targetDetails: CalibrationTreeTargetDetailsDescriptor[];
  };
}

export interface CalibrationTreeTierArtifact
  extends CalibrationTreePartIdentity {
  part: CalibrationTreeTierPart;
  depth: number;
  targetCount: number;
  levels: Record<string, CompiledCalibrationLevel>;
}

export interface CalibrationTreeTargetIndexArtifact
  extends CalibrationTreePartIdentity {
  part: "target-index";
  targets: IndexedCalibrationTarget[];
  postings: CalibrationTreeFilterPostings;
}

export interface CalibrationTreeTargetDetailsArtifact
  extends CalibrationTreePartIdentity {
  part: CalibrationTreeTargetDetailsPart;
  startTargetOrdinal: number;
  endTargetOrdinalExclusive: number;
  targets: CalibrationTreeTarget[];
}

export type CalibrationTreeArtifactPart =
  | CalibrationTreeIndexArtifact
  | CalibrationTreeTierArtifact
  | CalibrationTreeTargetIndexArtifact
  | CalibrationTreeTargetDetailsArtifact;

export interface CalibrationTreeBundleDraft {
  country: MicrocosmCountry;
  release: CalibrationTreeRelease;
  calibrationProvenance?: CalibrationProvenance;
  lossAttributionAvailable: boolean;
  filterOptions: CalibrationTreeResponse["filterOptions"];
  roots: CalibrationTreeIndexArtifact["roots"];
  levels: Record<string, CompiledCalibrationLevel>;
  levelDepths: Record<string, number>;
  targets: Array<Omit<IndexedCalibrationTarget, "detailLocation"> & {
    facets: {
      geographyLevel: string;
      geography: string;
      fitBand: FitBand;
      calibrationStatus: CalibrationStatus | null;
    };
    detail: CalibrationTreeTarget;
  }>;
}

export interface LoadedCalibrationTreeBundle {
  index: CalibrationTreeIndexArtifact;
  tiers: CalibrationTreeTierArtifact[];
  targetIndex?: CalibrationTreeTargetIndexArtifact;
  targetDetailShard?: CalibrationTreeTargetDetailsArtifact;
}

export interface CalibrationTreeTargetDetailsPlan {
  artifacts: CalibrationTreeTargetDetailsArtifact[];
  locations: IndexedCalibrationTarget["detailLocation"][];
}

export interface CalibrationTreeTargetDetailSelection {
  descriptor: CalibrationTreeTargetDetailsDescriptor;
  offset: number;
  targetOrdinal: number;
}

export interface CompileCalibrationTreeInput {
  country: MicrocosmCountry;
  releaseId: string;
  hfRepo: string;
  hfCommitSha: string;
  sourceArtifacts: CalibrationTreeSourceArtifacts;
  rows: CalibrationTreeTarget[];
  calibrationProvenance?: CalibrationProvenance;
  lossAttributionAvailable?: boolean;
}

const DEFAULT_GEOGRAPHY = "United States";
const DEFAULT_GEOGRAPHY_LEVEL = "national";
const SHA256_RE = /^[0-9a-f]{64}$/;
const HF_COMMIT_RE = /^[0-9a-f]{40,64}$/;
const TIER_PART_RE = /^tier-([1-9][0-9]*)$/;
const TARGET_DETAILS_PART_RE = /^target-details-([0-9]{4})$/;

function targetDetailsPart(shardIndex: number): CalibrationTreeTargetDetailsPart {
  const number = shardIndex + 1;
  if (!Number.isSafeInteger(number) || number < 1 || number > 9_999) {
    throw new Error("Calibration tree target-detail shard number is out of range.");
  }
  return `target-details-${String(number).padStart(4, "0")}`;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const result = finiteNumber(value);
  return result != null && result >= 0 ? result : null;
}

function targetIdentifier(row: CalibrationTreeTarget, index: number): string {
  return String(row.comparison_id ?? row.name ?? row.base_name ?? `target-${index}`);
}

function normalizeStatus(
  value: CalibrationTreeTarget["calibration_status"],
): CalibrationStatus | null {
  if (value === "included") return "included";
  if (value === "skipped" || value === "not_materialized") return "skipped";
  return null;
}

function compiledTarget(
  row: CalibrationTreeTarget,
  index: number,
): CalibrationTreeBundleDraft["targets"][number] {
  const error = finiteNumber(row.abs_relative_error);
  return {
    id: targetIdentifier(row, index),
    label: targetIdentifier(row, index),
    facets: {
      geographyLevel:
        String(row.level ?? "").trim() || DEFAULT_GEOGRAPHY_LEVEL,
      geography: String(row.geography ?? "").trim() || DEFAULT_GEOGRAPHY,
      fitBand: fitBandForTarget(row),
      calibrationStatus: normalizeStatus(row.calibration_status),
    },
    metricInputs: {
      absRelativeError: error == null ? null : Math.abs(error),
      targetLossWeightShare: nonnegativeNumber(row.target_loss_weight_share),
      finalLossContribution: nonnegativeNumber(row.final_loss_contribution),
      targetChange: finiteNumber(row.target_change),
      comparisonStatus:
        row.comparison_status === "shared" ||
        row.comparison_status === "added" ||
        row.comparison_status === "removed"
          ? row.comparison_status
          : null,
    },
    detail: row,
  };
}

function uniqueSorted(indices: number[]): number[] {
  return [...new Set(indices)].sort((left, right) => left - right);
}

function sameIndices(left: number[], right: number[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function semanticStateKey(state: ExplorerState): string {
  const path = {
    source: state.path.source,
    program: state.path.program,
    geography: state.path.geography,
    dimensions: state.path.dimensions.map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  };
  return path.source && path.program && path.geography
    ? JSON.stringify(path)
    : JSON.stringify({ breakdown: state.breakdown, path });
}

function targetOrdinalFor(
  target: CalibrationTreeTarget | undefined,
  targetOrdinals: Map<CalibrationTreeTarget, number>,
): number {
  if (!target) throw new Error("Compiled target node is missing target details.");
  const ordinal = targetOrdinals.get(target);
  if (ordinal == null) {
    throw new Error(`Compiled target ${String(target.name ?? target.base_name)} is unknown.`);
  }
  return ordinal;
}

export function compileCalibrationTreeBundleDraft(
  input: CompileCalibrationTreeInput,
): CalibrationTreeBundleDraft {
  if (!HF_COMMIT_RE.test(input.hfCommitSha)) {
    throw new Error(`Invalid Hugging Face commit SHA: ${input.hfCommitSha}`);
  }
  const rows = normalizeCalibrationTreeTargets(input.rows);
  const lossAttributionAvailable =
    input.lossAttributionAvailable ??
    (rows.length > 0 &&
      rows.every((row) => nonnegativeNumber(row.final_loss_contribution) != null));
  const targets = rows.map(compiledTarget);
  const targetOrdinals = new Map(rows.map((row, ordinal) => [row, ordinal]));
  const levels: Record<string, CompiledCalibrationLevel> = {};
  const stateLevels = new Map<string, string>();
  let nextLevelNumber = 0;
  let filterOptions: CalibrationTreeResponse["filterOptions"] | null = null;

  const compileLevel = (state: ExplorerState): string => {
    const stateKey = semanticStateKey(state);
    const existing = stateLevels.get(stateKey);
    if (existing) return existing;

    const levelId = `level-${String(nextLevelNumber).padStart(6, "0")}`;
    nextLevelNumber += 1;
    stateLevels.set(stateKey, levelId);

    const response = buildCalibrationTree(
      rows,
      state,
      input.releaseId,
      lossAttributionAvailable,
    );
    filterOptions ??= response.filterOptions;

    const groups = response.groups.map((group): CompiledCalibrationGroup => {
      const nodes = group.nodes.map((treeNode): CompiledCalibrationNode => {
        if (treeNode.kind === "target") {
          const targetOrdinal = targetOrdinalFor(treeNode.target, targetOrdinals);
          targets[targetOrdinal].id = treeNode.id;
          targets[targetOrdinal].label = treeNode.label;
          return {
            id: treeNode.id,
            label: treeNode.label,
            kind: "target",
            selection: treeNode.selection,
            targetOrdinals: [targetOrdinal],
            targetOrdinal,
            metrics: treeNode.metrics,
            authoredLabel: treeNode.authored_label,
          };
        }

        const childState = selectExplorerNode(state, treeNode.selection);
        if (semanticStateKey(childState) === stateKey) {
          throw new Error(`Selection ${treeNode.id} did not advance the calibration tree.`);
        }
        const nextLevelId = compileLevel(childState);
        return {
          id: treeNode.id,
          label: treeNode.label,
          kind: treeNode.kind,
          selection: treeNode.selection,
          targetOrdinals: levels[nextLevelId].targetOrdinals,
          nextLevelId,
          metrics: treeNode.metrics,
          authoredLabel: treeNode.authored_label,
        };
      });
      return {
        id: group.id,
        label: group.label,
        nodes,
        targetOrdinals: uniqueSorted(nodes.flatMap((node) => node.targetOrdinals)),
        metrics: group.metrics,
      };
    });

    levels[levelId] = {
      currentLevel: response.currentLevel,
      pathLabels: response.pathLabels,
      dimensionOrder: response.dimensionOrder,
      groups,
      targetOrdinals: uniqueSorted(groups.flatMap((group) => group.targetOrdinals)),
      metrics: response.filteredMetrics,
    };
    return levelId;
  };

  const roots = {
    program: compileLevel(createExplorerState()),
    geography: compileLevel({ ...createExplorerState(), breakdown: "geography" }),
  };
  const levelDepths: Record<string, number> = {};
  const queue = [
    { levelId: roots.program, depth: 0 },
    { levelId: roots.geography, depth: 0 },
  ];
  while (queue.length) {
    const { levelId, depth } = queue.shift()!;
    const previousDepth = levelDepths[levelId];
    if (previousDepth != null) {
      if (previousDepth !== depth) {
        throw new Error(`Calibration tree level ${levelId} is reachable at multiple depths.`);
      }
      continue;
    }
    levelDepths[levelId] = depth;
    for (const node of levels[levelId].groups.flatMap((group) => group.nodes)) {
      if (node.kind !== "target") {
        queue.push({ levelId: node.nextLevelId, depth: depth + 1 });
      }
    }
  }
  if (Object.keys(levelDepths).length !== Object.keys(levels).length) {
    throw new Error("Calibration tree contains an unreachable level.");
  }

  return {
    country: input.country,
    release: {
      releaseId: input.releaseId,
      hfRepo: input.hfRepo,
      hfCommitSha: input.hfCommitSha,
      sourceArtifacts: input.sourceArtifacts,
    },
    calibrationProvenance: input.calibrationProvenance,
    lossAttributionAvailable,
    filterOptions: filterOptions ?? {
      geographyLevels: [],
      geographies: [],
      fitBands: [],
      comparisonFits: [],
      calibrationStatuses: [],
    },
    roots,
    levels,
    levelDepths,
    targets,
  };
}

function postingValues<T extends string | null>(values: T[]): CalibrationTreePosting<T>[] {
  const postings = new Map<T, number[]>();
  values.forEach((value, index) => {
    const indices = postings.get(value) ?? [];
    indices.push(index);
    postings.set(value, indices);
  });
  return [...postings.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([value, targetOrdinals]) => ({ value, targetOrdinals }));
}

export function calibrationTreeTargetIndexFromDraft(
  draft: CalibrationTreeBundleDraft,
  detailLocations: IndexedCalibrationTarget["detailLocation"][],
): CalibrationTreeTargetIndexArtifact {
  if (detailLocations.length !== draft.targets.length) {
    throw new Error("Calibration tree target-detail locations do not cover every target.");
  }
  return {
    schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
    country: draft.country,
    hfCommitSha: draft.release.hfCommitSha,
    part: "target-index",
    targets: draft.targets.map(({ id, label, metricInputs }, targetOrdinal) => ({
      id,
      label,
      metricInputs,
      detailLocation: detailLocations[targetOrdinal],
    })),
    postings: {
      geographyLevels: postingValues(
        draft.targets.map((target) => target.facets.geographyLevel),
      ),
      geographies: postingValues(
        draft.targets.map((target) => target.facets.geography),
      ),
      fitBands: postingValues(
        draft.targets.map((target) => target.facets.fitBand),
      ),
      comparisonFits: [],
      calibrationStatuses: postingValues(
        draft.targets.map((target) => target.facets.calibrationStatus),
      ),
    },
  };
}

export function calibrationTreeTargetDetailsFromDraft(
  draft: CalibrationTreeBundleDraft,
  maxRawBytes = CALIBRATION_TREE_TARGET_DETAIL_MAX_RAW_BYTES,
): CalibrationTreeTargetDetailsPlan {
  if (!Number.isSafeInteger(maxRawBytes) || maxRawBytes <= 0) {
    throw new Error("Calibration tree target-detail shard size must be a positive integer.");
  }
  const serializedTargets = draft.targets.map((target) => stableJson(target.detail));
  const targetBytes = serializedTargets.map(utf8Bytes);
  const artifacts: CalibrationTreeTargetDetailsArtifact[] = [];
  const locations: IndexedCalibrationTarget["detailLocation"][] = [];
  let startTargetOrdinal = 0;

  while (startTargetOrdinal < draft.targets.length) {
    const shardIndex = artifacts.length;
    if (shardIndex >= 9_999) {
      throw new Error("Calibration tree target details require more than 9,999 shards.");
    }
    const part = targetDetailsPart(shardIndex);
    let endTargetOrdinalExclusive = startTargetOrdinal;
    let payloadBytes = 0;

    while (endTargetOrdinalExclusive < draft.targets.length) {
      const nextPayloadBytes =
        payloadBytes +
        targetBytes[endTargetOrdinalExclusive] +
        (endTargetOrdinalExclusive === startTargetOrdinal ? 0 : 1);
      const emptyArtifact: CalibrationTreeTargetDetailsArtifact = {
        schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
        country: draft.country,
        hfCommitSha: draft.release.hfCommitSha,
        part,
        startTargetOrdinal,
        endTargetOrdinalExclusive: endTargetOrdinalExclusive + 1,
        targets: [],
      };
      const candidateBytes = utf8Bytes(`${stableJson(emptyArtifact)}\n`) + nextPayloadBytes;
      if (candidateBytes > maxRawBytes) break;
      payloadBytes = nextPayloadBytes;
      endTargetOrdinalExclusive += 1;
    }

    if (endTargetOrdinalExclusive === startTargetOrdinal) {
      const targetBytesWithEnvelope = utf8Bytes(`${stableJson({
        schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
        country: draft.country,
        hfCommitSha: draft.release.hfCommitSha,
        part,
        startTargetOrdinal,
        endTargetOrdinalExclusive: startTargetOrdinal + 1,
        targets: [draft.targets[startTargetOrdinal].detail],
      })}\n`);
      throw new Error(
        `Calibration target ordinal ${startTargetOrdinal} requires ${targetBytesWithEnvelope} bytes, ` +
        `which exceeds the ${maxRawBytes}-byte shard limit.`,
      );
    }

    const artifact: CalibrationTreeTargetDetailsArtifact = {
      schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
      country: draft.country,
      hfCommitSha: draft.release.hfCommitSha,
      part,
      startTargetOrdinal,
      endTargetOrdinalExclusive,
      targets: draft.targets
        .slice(startTargetOrdinal, endTargetOrdinalExclusive)
        .map((target) => target.detail),
    };
    const serialized = serializeCalibrationTreePart(artifact);
    if (utf8Bytes(serialized) > maxRawBytes) {
      throw new Error(`Calibration tree shard ${part} exceeded its planned byte limit.`);
    }
    for (
      let targetOrdinal = startTargetOrdinal;
      targetOrdinal < endTargetOrdinalExclusive;
      targetOrdinal += 1
    ) {
      locations[targetOrdinal] = {
        shardIndex,
        offset: targetOrdinal - startTargetOrdinal,
      };
    }
    artifacts.push(artifact);
    startTargetOrdinal = endTargetOrdinalExclusive;
  }

  return { artifacts, locations };
}

export function calibrationTreeTargetDetailSelection(
  index: CalibrationTreeIndexArtifact,
  target: IndexedCalibrationTarget,
  targetOrdinal: number,
): CalibrationTreeTargetDetailSelection {
  const { shardIndex, offset } = target.detailLocation;
  const descriptor = index.parts.targetDetails[shardIndex];
  if (
    !Number.isSafeInteger(targetOrdinal) ||
    targetOrdinal < 0 ||
    !descriptor ||
    descriptor.startTargetOrdinal + offset !== targetOrdinal ||
    targetOrdinal >= descriptor.endTargetOrdinalExclusive
  ) {
    throw new Error(
      `Calibration target ordinal ${targetOrdinal} has an invalid detail location ` +
      `(${shardIndex}, ${offset}).`,
    );
  }
  return { descriptor, offset, targetOrdinal };
}

export function calibrationTreeTiersFromDraft(
  draft: CalibrationTreeBundleDraft,
): CalibrationTreeTierArtifact[] {
  const maxDepth = Math.max(0, ...Object.values(draft.levelDepths));
  return Array.from({ length: maxDepth }, (_, index) => index + 1).map((depth) => ({
    schemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
    country: draft.country,
    hfCommitSha: draft.release.hfCommitSha,
    part: `tier-${depth}`,
    depth,
    targetCount: draft.targets.length,
    levels: Object.fromEntries(
      Object.entries(draft.levels).filter(
        ([levelId]) => draft.levelDepths[levelId] === depth,
      ),
    ),
  }));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function serializeCalibrationTreePart(part: CalibrationTreeArtifactPart): string {
  parseCalibrationTreePart(part, part.part);
  return `${stableJson(part)}\n`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validateIndices(value: unknown, targetCount: number, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  let previous = -1;
  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item >= targetCount) {
      throw new Error(`${label} contains an invalid target index.`);
    }
    if (item <= previous) throw new Error(`${label} must be sorted and unique.`);
    previous = item;
  }
  return value as number[];
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value as string[];
}

function validateIdentity(
  value: unknown,
  expectedPart?: CalibrationTreePart,
): Record<string, unknown> {
  const part = record(value, "Calibration tree part");
  if (part.schemaVersion !== CALIBRATION_TREE_SCHEMA_VERSION) {
    throw new Error(`Unsupported calibration tree schema ${String(part.schemaVersion)}.`);
  }
  if (typeof part.country !== "string" || !isCountry(part.country)) {
    throw new Error("Calibration tree part has an unknown country.");
  }
  if (typeof part.hfCommitSha !== "string" || !HF_COMMIT_RE.test(part.hfCommitSha)) {
    throw new Error("Calibration tree part has an invalid Hugging Face commit SHA.");
  }
  if (typeof part.part !== "string" || !isCalibrationTreePart(part.part)) {
    throw new Error("Calibration tree part name is invalid.");
  }
  if (expectedPart && part.part !== expectedPart) {
    throw new Error(`Expected calibration tree part ${expectedPart}, received ${part.part}.`);
  }
  return part;
}

function validateLevelRecords(
  value: unknown,
  targetCount: number,
  label: string,
): Record<string, CompiledCalibrationLevel> {
  const levels = record(value, label);
  for (const [levelId, item] of Object.entries(levels)) {
    const level = record(item, `${label}.${levelId}`);
    const levelIndices = validateIndices(
      level.targetOrdinals,
      targetCount,
      `${levelId}.targetOrdinals`,
    );
    if (!Array.isArray(level.groups)) throw new Error(`${levelId}.groups must be an array.`);
    const indicesFromGroups: number[] = [];
    for (const [groupIndex, groupItem] of level.groups.entries()) {
      const group = record(groupItem, `${levelId}.groups[${groupIndex}]`);
      const groupIndices = validateIndices(
        group.targetOrdinals,
        targetCount,
        `${levelId}.groups[${groupIndex}].targetOrdinals`,
      );
      if (!Array.isArray(group.nodes)) {
        throw new Error(`${levelId}.groups[${groupIndex}].nodes must be an array.`);
      }
      const indicesFromNodes: number[] = [];
      for (const [nodeIndex, nodeItem] of group.nodes.entries()) {
        const node = record(nodeItem, `${levelId}.groups[${groupIndex}].nodes[${nodeIndex}]`);
        const indices = validateIndices(
          node.targetOrdinals,
          targetCount,
          `${levelId}.groups[${groupIndex}].nodes[${nodeIndex}].targetOrdinals`,
        );
        indicesFromNodes.push(...indices);
        if (node.kind === "target") {
          if (
            indices.length !== 1 ||
            !Number.isInteger(node.targetOrdinal) ||
            indices[0] !== node.targetOrdinal
          ) {
            throw new Error(`Target node ${String(node.id)} has an invalid target ordinal.`);
          }
        } else if (typeof node.nextLevelId !== "string" || !node.nextLevelId) {
          throw new Error(`Branch node ${String(node.id)} has an invalid next level.`);
        }
      }
      if (!sameIndices(groupIndices, uniqueSorted(indicesFromNodes))) {
        throw new Error(`${levelId}.groups[${groupIndex}] has inconsistent membership.`);
      }
      indicesFromGroups.push(...groupIndices);
    }
    if (!sameIndices(levelIndices, uniqueSorted(indicesFromGroups))) {
      throw new Error(`${levelId} has inconsistent membership.`);
    }
  }
  return levels as Record<string, CompiledCalibrationLevel>;
}

function validateDescriptor(
  value: unknown,
  expectedPart: Exclude<CalibrationTreePart, "index">,
  country: MicrocosmCountry,
  commit: string,
): CalibrationTreePartDescriptor {
  const descriptor = record(value, `Calibration tree descriptor ${expectedPart}`);
  if (descriptor.part !== expectedPart) {
    throw new Error(`Calibration tree descriptor ${expectedPart} has the wrong part name.`);
  }
  if (descriptor.path !== calibrationTreePartPath(country, commit, expectedPart)) {
    throw new Error(`Calibration tree descriptor ${expectedPart} has the wrong path.`);
  }
  if (typeof descriptor.sha256 !== "string" || !SHA256_RE.test(descriptor.sha256)) {
    throw new Error(`Calibration tree descriptor ${expectedPart} has an invalid hash.`);
  }
  for (const field of ["rawBytes", "gzipBytes"] as const) {
    if (!Number.isSafeInteger(descriptor[field]) || (descriptor[field] as number) <= 0) {
      throw new Error(`Calibration tree descriptor ${expectedPart} has invalid ${field}.`);
    }
  }
  return descriptor as unknown as CalibrationTreePartDescriptor;
}

function validateRelease(value: unknown, country: MicrocosmCountry, commit: string): void {
  const release = record(value, "Calibration tree release");
  if (typeof release.releaseId !== "string" || !release.releaseId) {
    throw new Error("Calibration tree release id is missing.");
  }
  if (typeof release.hfRepo !== "string" || !release.hfRepo) {
    throw new Error("Calibration tree repository is missing.");
  }
  if (release.hfCommitSha !== commit) {
    throw new Error("Calibration tree release commit does not match its part identity.");
  }
  const sources = record(release.sourceArtifacts, "Calibration tree source artifacts");
  for (const key of [
    "calibrationDiagnostics",
    "buildManifest",
    "releaseManifest",
    "demographics",
  ]) {
    if (sources[key] == null) {
      if (key === "calibrationDiagnostics") {
        throw new Error("Calibration diagnostics source is missing.");
      }
      continue;
    }
    const source = record(sources[key], `Calibration tree source ${key}`);
    if (
      typeof source.path !== "string" ||
      !source.path ||
      source.path.startsWith("/") ||
      source.path.split("/").includes("..")
    ) {
      throw new Error(`Calibration tree source ${key} has an invalid path.`);
    }
    if (typeof source.sha256 !== "string" || !SHA256_RE.test(source.sha256)) {
      throw new Error(`Calibration tree source ${key} has an invalid hash.`);
    }
  }
  if (!isCountry(country)) throw new Error("Calibration tree release country is invalid.");
}

export function parseCalibrationTreeIndex(value: unknown): CalibrationTreeIndexArtifact {
  const index = validateIdentity(value, "index");
  const country = index.country as MicrocosmCountry;
  const commit = index.hfCommitSha as string;
  validateRelease(index.release, country, commit);
  if (typeof index.lossAttributionAvailable !== "boolean") {
    throw new Error("Calibration tree loss-attribution availability must be boolean.");
  }
  if (!Number.isSafeInteger(index.targetCount) || (index.targetCount as number) < 0) {
    throw new Error("Calibration tree target count is invalid.");
  }
  const targetCount = index.targetCount as number;
  if (!Number.isSafeInteger(index.maxDepth) || (index.maxDepth as number) < 0) {
    throw new Error("Calibration tree maximum depth is invalid.");
  }
  const filters = record(index.filterOptions, "Calibration tree filter options");
  for (const key of [
    "geographyLevels",
    "geographies",
    "fitBands",
    "calibrationStatuses",
  ]) {
    stringArray(filters[key], `Calibration tree filter option ${key}`);
  }
  const levels = validateLevelRecords(
    index.levels,
    index.targetCount as number,
    "Calibration tree root levels",
  );
  const roots = record(index.roots, "Calibration tree roots");
  for (const rootName of ["program", "geography"] as const) {
    if (typeof roots[rootName] !== "string" || !levels[roots[rootName] as string]) {
      throw new Error(`Calibration tree ${rootName} root is invalid.`);
    }
  }
  const parts = record(index.parts, "Calibration tree part descriptors");
  if (!Array.isArray(parts.tiers)) {
    throw new Error("Calibration tree tier descriptors must be an array.");
  }
  const maxDepth = index.maxDepth as number;
  if (parts.tiers.length !== maxDepth) {
    throw new Error("Calibration tree tier descriptors are not contiguous.");
  }
  parts.tiers.forEach((item, tierIndex) => {
    const expectedDepth = tierIndex + 1;
    const expectedPart = `tier-${expectedDepth}` as CalibrationTreeTierPart;
    const descriptor = validateDescriptor(item, expectedPart, country, commit);
    const tier = descriptor as CalibrationTreeTierDescriptor;
    if (tier.depth !== expectedDepth) {
      throw new Error(`Calibration tree descriptor ${expectedPart} has the wrong depth.`);
    }
    stringArray(tier.levelIds, `Calibration tree descriptor ${expectedPart} levelIds`);
  });
  validateDescriptor(parts.targetIndex, "target-index", country, commit);
  if (!Array.isArray(parts.targetDetails)) {
    throw new Error("Calibration tree target-detail descriptors must be an array.");
  }
  let nextTargetOrdinal = 0;
  parts.targetDetails.forEach((item, shardIndex) => {
    const expectedPart = targetDetailsPart(shardIndex);
    const descriptor = validateDescriptor(item, expectedPart, country, commit) as
      CalibrationTreeTargetDetailsDescriptor;
    if (descriptor.rawBytes > CALIBRATION_TREE_TARGET_DETAIL_MAX_RAW_BYTES) {
      throw new Error(`Calibration tree descriptor ${expectedPart} exceeds the byte limit.`);
    }
    if (
      descriptor.startTargetOrdinal !== nextTargetOrdinal ||
      !Number.isSafeInteger(descriptor.endTargetOrdinalExclusive) ||
      descriptor.endTargetOrdinalExclusive <= descriptor.startTargetOrdinal ||
      descriptor.endTargetOrdinalExclusive > targetCount
    ) {
      throw new Error(`Calibration tree descriptor ${expectedPart} has an invalid target range.`);
    }
    nextTargetOrdinal = descriptor.endTargetOrdinalExclusive;
  });
  if (nextTargetOrdinal !== targetCount) {
    throw new Error("Calibration tree target-detail descriptors do not cover every target.");
  }
  return value as CalibrationTreeIndexArtifact;
}

export function parseCalibrationTreeTier(
  value: unknown,
  expectedPart?: CalibrationTreeTierPart,
): CalibrationTreeTierArtifact {
  const tier = validateIdentity(value, expectedPart);
  const match = String(tier.part).match(TIER_PART_RE);
  if (!match) throw new Error("Calibration tree tier part name is invalid.");
  const depth = Number(match[1]);
  if (tier.depth !== depth) throw new Error(`Calibration tree tier-${depth} has the wrong depth.`);
  if (!Number.isSafeInteger(tier.targetCount) || (tier.targetCount as number) < 0) {
    throw new Error(`Calibration tree tier-${depth} has an invalid target count.`);
  }
  validateLevelRecords(
    tier.levels,
    tier.targetCount as number,
    `Calibration tree tier-${depth} levels`,
  );
  return value as CalibrationTreeTierArtifact;
}

function validateMetricInputs(value: unknown, label: string): void {
  const inputs = record(value, label);
  for (const key of [
    "absRelativeError",
    "targetLossWeightShare",
    "finalLossContribution",
    "targetChange",
  ]) {
    if (inputs[key] != null &&
        (typeof inputs[key] !== "number" || !Number.isFinite(inputs[key]))) {
      throw new Error(`${label}.${key} must be a finite number or null.`);
    }
  }
  if (
    inputs.comparisonStatus != null &&
    !["shared", "added", "removed"].includes(String(inputs.comparisonStatus))
  ) {
    throw new Error(`${label}.comparisonStatus is invalid.`);
  }
}

function validatePostings(
  value: unknown,
  targetCount: number,
  label: string,
): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const posting = record(item, `${label}[${index}]`);
    if (posting.value !== null && typeof posting.value !== "string") {
      throw new Error(`${label}[${index}].value must be a string or null.`);
    }
    const key = posting.value === null ? "null" : `string:${posting.value}`;
    if (seen.has(key)) throw new Error(`${label} contains a duplicate value.`);
    seen.add(key);
    validateIndices(posting.targetOrdinals, targetCount, `${label}[${index}].targetOrdinals`);
  }
}

export function parseCalibrationTreeTargetIndex(
  value: unknown,
): CalibrationTreeTargetIndexArtifact {
  const part = validateIdentity(value, "target-index");
  if (!Array.isArray(part.targets)) {
    throw new Error("Calibration tree indexed targets must be an array.");
  }
  const ids = new Set<string>();
  part.targets.forEach((item, index) => {
    const target = record(item, `Calibration tree indexed target ${index}`);
    if (typeof target.id !== "string" || !target.id || typeof target.label !== "string") {
      throw new Error(`Calibration tree indexed target ${index} has invalid identity fields.`);
    }
    if (ids.has(target.id)) throw new Error(`Calibration target id ${target.id} is duplicated.`);
    ids.add(target.id);
    validateMetricInputs(target.metricInputs, `Calibration tree indexed target ${index}`);
    const location = record(
      target.detailLocation,
      `Calibration tree indexed target ${index} detailLocation`,
    );
    if (
      !Number.isSafeInteger(location.shardIndex) ||
      (location.shardIndex as number) < 0 ||
      !Number.isSafeInteger(location.offset) ||
      (location.offset as number) < 0
    ) {
      throw new Error(`Calibration tree indexed target ${index} has an invalid detail location.`);
    }
  });
  const postings = record(part.postings, "Calibration tree filter postings");
  for (const key of [
    "geographyLevels",
    "geographies",
    "fitBands",
    "calibrationStatuses",
  ]) {
    validatePostings(
      postings[key],
      part.targets.length,
      `Calibration tree filter postings ${key}`,
    );
  }
  return value as CalibrationTreeTargetIndexArtifact;
}

export function parseCalibrationTreeTargetDetails(
  value: unknown,
  expectedPart?: CalibrationTreeTargetDetailsPart,
): CalibrationTreeTargetDetailsArtifact {
  const part = validateIdentity(value, expectedPart);
  if (typeof part.part !== "string" || !TARGET_DETAILS_PART_RE.test(part.part)) {
    throw new Error("Calibration tree target-detail part name is invalid.");
  }
  if (
    !Number.isSafeInteger(part.startTargetOrdinal) ||
    (part.startTargetOrdinal as number) < 0 ||
    !Number.isSafeInteger(part.endTargetOrdinalExclusive) ||
    (part.endTargetOrdinalExclusive as number) <= (part.startTargetOrdinal as number)
  ) {
    throw new Error("Calibration tree target-detail range is invalid.");
  }
  if (!Array.isArray(part.targets)) {
    throw new Error("Calibration tree target details must be an array.");
  }
  if (
    part.targets.length !==
      (part.endTargetOrdinalExclusive as number) - (part.startTargetOrdinal as number)
  ) {
    throw new Error("Calibration tree target-detail count does not match its range.");
  }
  part.targets.forEach((item, index) => {
    record(item, `Calibration tree target detail ${index}`);
  });
  return value as CalibrationTreeTargetDetailsArtifact;
}

export function parseCalibrationTreePart(
  value: unknown,
  expectedPart?: CalibrationTreePart,
): CalibrationTreeArtifactPart {
  const identity = validateIdentity(value, expectedPart);
  if (identity.part === "index") return parseCalibrationTreeIndex(value);
  if (identity.part === "target-index") return parseCalibrationTreeTargetIndex(value);
  if (TARGET_DETAILS_PART_RE.test(String(identity.part))) {
    return parseCalibrationTreeTargetDetails(
      value,
      identity.part as CalibrationTreeTargetDetailsPart,
    );
  }
  return parseCalibrationTreeTier(value, identity.part as CalibrationTreeTierPart);
}

function sameSelection(
  node: CompiledCalibrationNode,
  selection: ExplorerNodeSelection,
): boolean {
  if (node.kind !== selection.kind) return false;
  if (selection.kind === "program") {
    return (
      node.selection.kind === "program" &&
      node.selection.source === selection.source &&
      node.selection.value === selection.value
    );
  }
  if (selection.kind === "dimension_value") {
    return (
      node.selection.kind === "dimension_value" &&
      node.selection.key === selection.key &&
      node.selection.value === selection.value
    );
  }
  return node.selection.value === selection.value;
}

function selectedPath(state: ExplorerState): ExplorerNodeSelection[] {
  const selections: ExplorerNodeSelection[] = [];
  if (state.breakdown === "geography" && state.path.geography) {
    selections.push({ kind: "geography", value: state.path.geography });
  }
  if (state.path.source && state.path.program) {
    selections.push({
      kind: "program",
      source: state.path.source,
      value: state.path.program,
    });
  }
  if (state.breakdown === "program" && state.path.geography) {
    selections.push({ kind: "geography", value: state.path.geography });
  }
  selections.push(
    ...state.path.dimensions.map((dimension) => ({
      kind: "dimension_value" as const,
      key: dimension.key,
      label: dimension.label ?? dimension.key,
      value: dimension.value,
    })),
  );
  return selections;
}

function membershipForFilters(
  targetIndex: CalibrationTreeTargetIndexArtifact,
  filters: ExplorerState["filters"],
): Uint8Array {
  const membership = new Uint8Array(targetIndex.targets.length);
  membership.fill(1);
  for (const [key, selected] of Object.entries(filters) as Array<
    [keyof ExplorerState["filters"], string[]]
  >) {
    if (!selected.length) continue;
    const category = new Uint8Array(targetIndex.targets.length);
    const postings = targetIndex.postings[key] as CalibrationTreePosting[];
    for (const posting of postings) {
      if (posting.value != null && selected.includes(posting.value)) {
        for (const targetOrdinal of posting.targetOrdinals) category[targetOrdinal] = 1;
      }
    }
    for (let index = 0; index < membership.length; index += 1) {
      membership[index] &= category[index];
    }
  }
  return membership;
}

function targetDetailForOrdinal(
  shard: CalibrationTreeTargetDetailsArtifact | undefined,
  targetOrdinal: number,
): CalibrationTreeTarget | undefined {
  if (
    !shard ||
    targetOrdinal < shard.startTargetOrdinal ||
    targetOrdinal >= shard.endTargetOrdinalExclusive
  ) {
    return undefined;
  }
  return shard.targets[targetOrdinal - shard.startTargetOrdinal];
}

function loadedLevels(bundle: LoadedCalibrationTreeBundle) {
  return Object.assign(
    {},
    bundle.index.levels,
    ...bundle.tiers.map((tier) => tier.levels),
  ) as Record<string, CompiledCalibrationLevel>;
}

export function calibrationTreeResponseFromBundle(
  bundle: LoadedCalibrationTreeBundle,
  state: ExplorerState,
): CalibrationTreeResponse | null {
  const levels = loadedLevels(bundle);
  let levelId = bundle.index.roots[state.breakdown];
  for (const selection of selectedPath(state)) {
    const level = levels[levelId];
    if (!level) return null;
    const node = level.groups
      .flatMap((group) => group.nodes)
      .find((candidate) => sameSelection(candidate, selection));
    if (!node || node.kind === "target") {
      throw new Error(`Calibration tree does not contain the selected ${selection.kind}.`);
    }
    levelId = node.nextLevelId;
  }
  const level = levels[levelId];
  if (!level) return null;

  const hasFilters = Object.values(state.filters).some((values) => values.length > 0);
  if (hasFilters && !bundle.targetIndex) return null;
  const membership = bundle.targetIndex
    ? membershipForFilters(bundle.targetIndex, state.filters)
    : null;
  const filterIndices = (indices: number[]) =>
    membership ? indices.filter((index) => membership[index] === 1) : indices;
  const metrics = (indices: number[], fallback: CalibrationTreeMetrics) =>
    hasFilters && bundle.targetIndex
      ? calibrationTreeMetricsFromInputs(
          indices.map((index) => bundle.targetIndex!.targets[index].metricInputs),
        )
      : fallback;

  const groups: CalibrationTreeGroup[] = level.groups.flatMap((group) => {
    const groupIndices = filterIndices(group.targetOrdinals);
    if (!groupIndices.length) return [];
    const nodes: CalibrationTreeNode[] = group.nodes.flatMap((node) => {
      const nodeIndices = filterIndices(node.targetOrdinals);
      if (!nodeIndices.length) return [];
      return [{
        id: node.id,
        label: node.label,
        kind: node.kind,
        selection: node.selection,
        metrics: metrics(nodeIndices, node.metrics),
        target:
          node.kind === "target"
            ? targetDetailForOrdinal(bundle.targetDetailShard, node.targetOrdinal)
            : undefined,
        authored_label: node.authoredLabel,
      }];
    });
    if (!nodes.length) return [];
    return [{
      id: group.id,
      label: group.label,
      nodes,
      metrics: metrics(groupIndices, group.metrics),
    }];
  });
  const levelIndices = filterIndices(level.targetOrdinals);

  return {
    releaseId: bundle.index.release.releaseId,
    calibrationProvenance: bundle.index.calibrationProvenance,
    lossAttributionAvailable: bundle.index.lossAttributionAvailable,
    path: state.path,
    pathLabels: level.pathLabels,
    currentLevel: level.currentLevel,
    groups,
    dimensionOrder: level.dimensionOrder,
    filterOptions: bundle.index.filterOptions,
    filteredMetrics: metrics(levelIndices, level.metrics),
  };
}

export function isCalibrationTreePart(value: string): value is CalibrationTreePart {
  return value === "index" ||
    value === "target-index" ||
    (TARGET_DETAILS_PART_RE.test(value) && value !== "target-details-0000") ||
    TIER_PART_RE.test(value);
}

export function calibrationTreePartDepth(part: CalibrationTreePart): number | null {
  const match = part.match(TIER_PART_RE);
  return match ? Number(match[1]) : null;
}

export function calibrationTreeBundlePrefix(
  country: MicrocosmCountry,
  hfCommitSha: string,
): string {
  if (!HF_COMMIT_RE.test(hfCommitSha)) throw new Error("Invalid Hugging Face commit SHA.");
  return `calibration-trees/${country}/${hfCommitSha}`;
}

export function calibrationTreePartPath(
  country: MicrocosmCountry,
  hfCommitSha: string,
  part: CalibrationTreePart,
): string {
  if (!isCalibrationTreePart(part)) throw new Error("Invalid calibration tree part.");
  return `${calibrationTreeBundlePrefix(country, hfCommitSha)}/${part}.json`;
}

export function isSha256(value: string): boolean {
  return SHA256_RE.test(value);
}

export function isHfCommitSha(value: string): boolean {
  return HF_COMMIT_RE.test(value);
}
