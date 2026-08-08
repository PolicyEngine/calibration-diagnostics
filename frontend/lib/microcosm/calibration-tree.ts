import type {
  CalibrationStatus,
  ExplorerNodeSelection,
  ExplorerState,
  FitBand,
} from "./calibration-explorer";
import { canonicalLabel, programLabel } from "./program-label";
import { sourceLabel } from "./source-label";

const LOSS_ERROR_CAP = 2;
const HUBER_DELTA = 2;
export const MISSING_VALUE = "__missing__";

export interface CalibrationTreeDimension {
  key: string;
  label: string;
  value: string;
  source_key?: string;
  raw_value?: string;
}

export interface CalibrationTreeTarget {
  name?: string | null;
  base_name?: string | null;
  source?: string | null;
  variable?: string | null;
  variable_key?: string | null;
  measure?: string | null;
  source_measure_id?: string | null;
  level?: string | null;
  geography?: string | null;
  abs_relative_error?: number | null;
  calibration_status?: CalibrationStatus | null;
  target_dimensions?: CalibrationTreeDimension[] | null;
  [key: string]: unknown;
}

export interface CalibrationTreeMetrics {
  nTargets: number;
  scored: number;
  within10Pct: number;
  loss: number;
  huberLoss: number;
  huberErrorIntensity: number | null;
  meanAbsRelativeError: number | null;
  medianAbsRelativeError: number | null;
}

export interface CalibrationTreeNode {
  id: string;
  label: string;
  kind: ExplorerNodeSelection["kind"];
  selection: ExplorerNodeSelection;
  metrics: CalibrationTreeMetrics;
  target?: CalibrationTreeTarget;
}

export interface CalibrationTreeGroup {
  id: string;
  label: string;
  nodes: CalibrationTreeNode[];
  metrics: CalibrationTreeMetrics;
}

export interface CalibrationTreeResponse {
  releaseId?: string;
  path: ExplorerState["path"];
  currentLevel:
    | { kind: "overview"; label: string }
    | { kind: "geography"; label: string }
    | { kind: "dimension"; key: string; label: string }
    | { kind: "mixed"; label: string }
    | { kind: "target"; label: string };
  groups: CalibrationTreeGroup[];
  dimensionOrder: Array<{ key: string; label: string }>;
  filterOptions: {
    geographyLevels: string[];
    geographies: string[];
    fitBands: string[];
    calibrationStatuses: string[];
  };
  filteredMetrics: CalibrationTreeMetrics;
}

export type CalibrationTreeSizeMode = "targets" | "loss" | "error_intensity";

function finiteError(row: CalibrationTreeTarget): number | null {
  const value = row.abs_relative_error;
  return typeof value === "number" && Number.isFinite(value) ? Math.abs(value) : null;
}

export function fitBandForTarget(row: CalibrationTreeTarget): FitBand {
  const error = finiteError(row);
  if (error == null) return "unscored";
  if (error <= 0.05) return "0_5";
  if (error <= 0.1) return "5_10";
  if (error <= 0.2) return "10_20";
  if (error <= 0.4) return "20_40";
  return "40_plus";
}

export function applyExplorerFilters(
  rows: CalibrationTreeTarget[],
  filters: ExplorerState["filters"],
): CalibrationTreeTarget[] {
  return rows.filter((row) => {
    const geographyLevel = String(row.level ?? "").trim() || MISSING_VALUE;
    const geography = String(row.geography ?? "").trim() || MISSING_VALUE;
    const status = row.calibration_status ?? null;
    return (
      (!filters.geographyLevels.length || filters.geographyLevels.includes(geographyLevel)) &&
      (!filters.geographies.length || filters.geographies.includes(geography)) &&
      (!filters.fitBands.length || filters.fitBands.includes(fitBandForTarget(row))) &&
      (!filters.calibrationStatuses.length ||
        (status != null && filters.calibrationStatuses.includes(status)))
    );
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function huberLoss(error: number): number {
  return error <= HUBER_DELTA
    ? 0.5 * error * error
    : HUBER_DELTA * (error - 0.5 * HUBER_DELTA);
}

export function calibrationTreeMetrics(
  rows: CalibrationTreeTarget[],
): CalibrationTreeMetrics {
  const errors = rows.map(finiteError).filter((value): value is number => value != null);
  const loss = errors.reduce((sum, error) => {
    const capped = Math.min(error, LOSS_ERROR_CAP);
    return sum + capped * capped;
  }, 0);
  const totalHuberLoss = errors.reduce((sum, error) => sum + huberLoss(error), 0);
  return {
    nTargets: rows.length,
    scored: errors.length,
    within10Pct: errors.filter((error) => error <= 0.1).length,
    loss,
    huberLoss: totalHuberLoss,
    huberErrorIntensity: errors.length
      ? Math.sqrt((2 * totalHuberLoss) / errors.length)
      : null,
    meanAbsRelativeError: errors.length
      ? errors.reduce((sum, error) => sum + error, 0) / errors.length
      : null,
    medianAbsRelativeError: median(errors),
  };
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function programId(row: CalibrationTreeTarget): string {
  const variable = String(row.variable ?? "").trim();
  if (variable) return variable;
  const source = String(row.source ?? "").trim();
  const variableKey = String(row.variable_key ?? "").trim();
  if (variableKey) {
    const prefix = source ? `${source} / ` : "";
    return (prefix && variableKey.startsWith(prefix)
      ? variableKey.slice(prefix.length)
      : variableKey
    ).replace(/\s+·\s+(count|total|amount|mean)$/i, "");
  }
  return String(row.name ?? row.base_name ?? "unknown");
}

interface BreakdownDimension {
  key: string;
  label: string;
}

// These concepts are already represented elsewhere in the explorer or were
// explicitly rejected as navigation levels. Match exact semantic keys so a
// legitimate dimension such as `bd_amount_basis` remains explorable.
const NON_NAVIGABLE_BREAKDOWN_DIMENSIONS = new Set([
  "bd_amount",
  "bd_count",
  "bd_geography",
  "bd_geography_level",
  "bd_level",
  "bd_measure",
  "bd_state",
  "bd_state_abbreviation",
]);

function isNavigableBreakdownDimension(key: string): boolean {
  return /^bd_[a-z0-9_]+$/.test(key) && !NON_NAVIGABLE_BREAKDOWN_DIMENSIONS.has(key);
}

function rowDimensionValue(
  row: CalibrationTreeTarget,
  key: string,
): string | null {
  const values = [
    ...new Set(
      (row.target_dimensions ?? [])
        .filter((dimension) => dimension.key === key)
        .map((dimension) => String(dimension.value ?? "").trim())
        .filter(Boolean),
    ),
  ];
  return values.length === 1 ? values[0] : null;
}

export function orderedBreakdownDimensions(
  rows: CalibrationTreeTarget[],
): Array<{ key: string; label: string }> {
  const labelsByKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const dimension of row.target_dimensions ?? []) {
      if (!isNavigableBreakdownDimension(dimension.key)) continue;
      const labels = labelsByKey.get(dimension.key) ?? new Map<string, number>();
      const label = String(dimension.label ?? "").trim();
      if (label) labels.set(label, (labels.get(label) ?? 0) + 1);
      labelsByKey.set(dimension.key, labels);
    }
  }

  return [...labelsByKey.entries()]
    .map(([key, labels]) => ({
      key,
      label: canonicalLabel(
        [...labels.entries()].sort(
          ([leftLabel, leftCount], [rightLabel, rightCount]) =>
            rightCount - leftCount || leftLabel.localeCompare(rightLabel),
        )[0]?.[0] ?? key.slice(3),
      ),
      coverage: rows.filter((row) => rowDimensionValue(row, key) != null).length,
      distinctValues: new Set(
        rows
          .map((row) => rowDimensionValue(row, key))
          .filter((value): value is string => value != null),
      ).size,
    }))
    .sort((left, right) => {
      return (
        Number(right.distinctValues > 1) - Number(left.distinctValues > 1) ||
        right.coverage - left.coverage ||
        left.distinctValues - right.distinctValues ||
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key)
      );
    })
    .map(({ key, label }) => ({ key, label }));
}

function geographyId(row: CalibrationTreeTarget): string {
  return String(row.geography ?? "").trim() || MISSING_VALUE;
}

function targetLabel(row: CalibrationTreeTarget): string {
  const sourceMeasureId = String(row.source_measure_id ?? "").trim();
  if (sourceMeasureId) return humanize(sourceMeasureId);
  const id = String(row.name ?? row.base_name ?? "Target");
  const leaf = id.replace(/@[^@]+$/, "").split(/[./]/).filter(Boolean).at(-1);
  return humanize(leaf ?? id);
}

interface DimensionPartition {
  dimension: BreakdownDimension;
  rows: CalibrationTreeTarget[];
}

function partitionRowsByDimension(
  rows: CalibrationTreeTarget[],
  selectedKeys: Set<string>,
): { dimensions: DimensionPartition[]; targets: CalibrationTreeTarget[] } {
  const remaining = new Set(rows);
  const rankedDimensions = orderedBreakdownDimensions(rows).filter(
    (dimension) => !selectedKeys.has(dimension.key),
  );
  const displayRank = new Map(
    rankedDimensions.map((dimension, index) => [dimension.key, index]),
  );
  const candidates = rankedDimensions.flatMap((dimension) => {
    const eligibleRows = rows.filter(
      (row) => rowDimensionValue(row, dimension.key) != null,
    );
    const values = new Set(
      eligibleRows
        .map((row) => rowDimensionValue(row, dimension.key))
        .filter((value): value is string => value != null),
    );
    return values.size > 1 ? [{ dimension, rows: eligibleRows }] : [];
  });

  // Allocate narrower sparse dimensions first so a broader overlapping
  // dimension cannot consume every one of their rows. Display order remains
  // independently ranked by branch coverage and cardinality.
  const partitionsByKey = new Map<string, DimensionPartition>();
  for (const candidate of [...candidates].sort(
    (left, right) =>
      left.rows.length - right.rows.length ||
      (displayRank.get(left.dimension.key) ?? 0) -
        (displayRank.get(right.dimension.key) ?? 0),
  )) {
    const assigned = candidate.rows.filter((row) => remaining.has(row));
    const values = new Set(
      assigned
        .map((row) => rowDimensionValue(row, candidate.dimension.key))
        .filter((value): value is string => value != null),
    );
    if (values.size <= 1) continue;
    partitionsByKey.set(candidate.dimension.key, {
      dimension: candidate.dimension,
      rows: assigned,
    });
    for (const row of assigned) remaining.delete(row);
  }

  return {
    dimensions: rankedDimensions.flatMap((dimension) => {
      const partition = partitionsByKey.get(dimension.key);
      return partition ? [partition] : [];
    }),
    targets: [...remaining],
  };
}

function groupRows(
  rows: CalibrationTreeTarget[],
  keyOf: (row: CalibrationTreeTarget) => string,
): Map<string, CalibrationTreeTarget[]> {
  const groups = new Map<string, CalibrationTreeTarget[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function node(
  id: string,
  label: string,
  kind: CalibrationTreeNode["kind"],
  selection: ExplorerNodeSelection,
  rows: CalibrationTreeTarget[],
  target?: CalibrationTreeTarget,
): CalibrationTreeNode {
  return { id, label, kind, selection, metrics: calibrationTreeMetrics(rows), target };
}

function sortNodes(nodes: CalibrationTreeNode[]): CalibrationTreeNode[] {
  return nodes.sort(
    (left, right) =>
      right.metrics.nTargets - left.metrics.nTargets ||
      (left.id === MISSING_VALUE ? 1 : right.id === MISSING_VALUE ? -1 : left.label.localeCompare(right.label)),
  );
}

function filterOptions(rows: CalibrationTreeTarget[]) {
  const unique = (values: Array<string | null | undefined>) =>
    [...new Set(values.map((value) => String(value ?? "").trim() || MISSING_VALUE))].sort(
      (left, right) =>
        left === MISSING_VALUE ? 1 : right === MISSING_VALUE ? -1 : left.localeCompare(right),
    );
  return {
    geographyLevels: unique(rows.map((row) => row.level)),
    geographies: unique(rows.map((row) => row.geography)),
    fitBands: ["0_5", "5_10", "10_20", "20_40", "40_plus", "unscored"],
    calibrationStatuses: ["included", "skipped", "not_materialized"],
  };
}

function programGroups(rows: CalibrationTreeTarget[]): CalibrationTreeGroup[] {
  const bySource = groupRows(
    rows,
    (row) => String(row.source ?? "other") || "other",
  );
  return [...bySource.entries()]
    .map(([source, sourceRows]) => {
      const byProgram = groupRows(sourceRows, programId);
      const nodes = sortNodes(
        [...byProgram.entries()].map(([program, programRows]) =>
          node(
            program,
            programLabel(program),
            "program",
            { kind: "program", source, value: program },
            programRows,
          ),
        ),
      );
      return {
        id: source,
        label: sourceLabel(source),
        nodes,
        metrics: calibrationTreeMetrics(sourceRows),
      };
    })
    .sort(
      (left, right) =>
        right.metrics.nTargets - left.metrics.nTargets ||
        left.id.localeCompare(right.id),
    );
}

function geographyNodes(rows: CalibrationTreeTarget[]): CalibrationTreeNode[] {
  const byGeography = groupRows(rows, geographyId);
  return sortNodes(
    [...byGeography.entries()].map(([geography, geographyRows]) =>
      node(
        geography,
        geography === MISSING_VALUE ? "Not specified" : geography,
        "geography",
        { kind: "geography", value: geography },
        geographyRows,
      ),
    ),
  );
}

export function buildCalibrationTree(
  allRows: CalibrationTreeTarget[],
  state: ExplorerState,
  releaseId?: string,
): CalibrationTreeResponse {
  const { path } = state;
  const options = filterOptions(allRows);
  const filteredRows = applyExplorerFilters(allRows, state.filters);

  if (state.breakdown === "geography" && !path.geography) {
    const nodes = geographyNodes(filteredRows);
    return {
      releaseId,
      path,
      currentLevel: { kind: "geography", label: "Geography" },
      groups: [{
        id: "geography",
        label: "Geography",
        nodes,
        metrics: calibrationTreeMetrics(filteredRows),
      }],
      dimensionOrder: [],
      filterOptions: options,
      filteredMetrics: calibrationTreeMetrics(filteredRows),
    };
  }

  if (state.breakdown === "geography" && (!path.source || !path.program)) {
    const geographyRows = allRows.filter(
      (row) => geographyId(row) === path.geography,
    );
    const filteredGeographyRows = applyExplorerFilters(
      geographyRows,
      state.filters,
    );
    return {
      releaseId,
      path,
      currentLevel: { kind: "overview", label: "Programs" },
      groups: programGroups(filteredGeographyRows),
      dimensionOrder: [],
      filterOptions: options,
      filteredMetrics: calibrationTreeMetrics(filteredGeographyRows),
    };
  }

  if (!path.source || !path.program) {
    return {
      releaseId,
      path,
      currentLevel: { kind: "overview", label: "Programs" },
      groups: programGroups(filteredRows),
      dimensionOrder: [],
      filterOptions: options,
      filteredMetrics: calibrationTreeMetrics(filteredRows),
    };
  }

  const programRows = allRows.filter(
    (row) =>
      String(row.source ?? "other") === path.source &&
      programId(row) === path.program,
  );
  const filteredProgramRows = applyExplorerFilters(programRows, state.filters);
  if (!path.geography) {
    const allGeographyNodes = geographyNodes(programRows);
    const onlyMissingGeography =
      allGeographyNodes.length === 1 &&
      allGeographyNodes[0].id === MISSING_VALUE;
    if (!onlyMissingGeography) {
      const nodes = geographyNodes(filteredProgramRows);
      return {
        releaseId,
        path,
        currentLevel: { kind: "geography", label: "Geography" },
        groups: [{
          id: path.program,
          label: path.program,
          nodes,
          metrics: calibrationTreeMetrics(filteredProgramRows),
        }],
        dimensionOrder: [],
        filterOptions: options,
        filteredMetrics: calibrationTreeMetrics(filteredProgramRows),
      };
    }
  }

  const geographyRows = path.geography
    ? programRows.filter((row) => geographyId(row) === path.geography)
    : programRows;
  const dimensionOrder = orderedBreakdownDimensions(geographyRows);
  let scopedRows = geographyRows;
  const selectedKeys = new Set<string>();
  for (const selection of path.dimensions) {
    const selectedPartition = partitionRowsByDimension(scopedRows, selectedKeys).dimensions.find(
      ({ dimension }) => dimension.key === selection.key,
    );
    if (!selectedPartition) {
      scopedRows = [];
      break;
    }
    scopedRows = selectedPartition.rows.filter(
      (row) => rowDimensionValue(row, selection.key) === selection.value,
    );
    selectedKeys.add(selection.key);
  }
  const filteredScopedRows = applyExplorerFilters(scopedRows, state.filters);
  const visibleRows = new Set(filteredScopedRows);
  const partition = partitionRowsByDimension(scopedRows, selectedKeys);

  const groups: CalibrationTreeGroup[] = partition.dimensions.flatMap(
    ({ dimension, rows: dimensionRows }) => {
      const visibleDimensionRows = dimensionRows.filter((row) => visibleRows.has(row));
      if (!visibleDimensionRows.length) return [];
      const byValue = groupRows(
        visibleDimensionRows,
        (row) => rowDimensionValue(row, dimension.key) ?? "",
      );
      const nodes = sortNodes(
        [...byValue.entries()].map(([value, rows]) =>
          node(
            value,
            value,
            "dimension_value",
            {
              kind: "dimension_value",
              key: dimension.key,
              label: dimension.label,
              value,
            },
            rows,
          ),
        ),
      );
      return [{
        id: dimension.key,
        label: dimension.label,
        nodes,
        metrics: calibrationTreeMetrics(visibleDimensionRows),
      }];
    },
  );

  const visibleTargets = partition.targets.filter((row) => visibleRows.has(row));
  const targetNodes = visibleTargets
    .map((row, index) => {
      const id = String(row.name ?? row.base_name ?? `target-${index}`);
      return node(
        id,
        targetLabel(row),
        "target",
        { kind: "target", value: id },
        [row],
        row,
      );
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  if (targetNodes.length) {
    groups.push({
      id: "targets",
      label: "Targets",
      nodes: targetNodes,
      metrics: calibrationTreeMetrics(visibleTargets),
    });
  }

  const currentLevel =
    partition.dimensions.length === 1 && partition.targets.length === 0
      ? { kind: "dimension" as const, ...partition.dimensions[0].dimension }
      : partition.dimensions.length === 0
        ? { kind: "target" as const, label: "Targets" }
        : { kind: "mixed" as const, label: "Breakdowns and targets" };
  return {
    releaseId,
    path,
    currentLevel,
    groups,
    dimensionOrder,
    filterOptions: options,
    filteredMetrics: calibrationTreeMetrics(filteredScopedRows),
  };
}

export function effectiveNodeMetric(
  nodes: CalibrationTreeNode[],
  mode: CalibrationTreeSizeMode,
): number[] {
  const values = nodes.map((item) => {
    if (mode === "targets") return item.metrics.nTargets;
    if (mode === "loss") return item.metrics.loss;
    return item.metrics.huberErrorIntensity ?? 0;
  });
  return values.some((value) => value > 0)
    ? values
    : nodes.map((item) => item.metrics.nTargets);
}
