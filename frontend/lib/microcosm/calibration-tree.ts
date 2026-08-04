import type {
  CalibrationStatus,
  ExplorerNodeSelection,
  ExplorerState,
  FitBand,
} from "./calibration-explorer";

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
    | { kind: "measure"; label: string }
    | { kind: "dimension"; key: string; label: string }
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

function rowDimensionValue(row: CalibrationTreeTarget, key: string): string {
  return row.target_dimensions?.find((dimension) => dimension.key === key)?.value || MISSING_VALUE;
}

export function orderedBreakdownDimensions(
  rows: CalibrationTreeTarget[],
): Array<{ key: string; label: string }> {
  const dimensions: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const dimension of row.target_dimensions ?? []) {
      if (seen.has(dimension.key)) continue;
      seen.add(dimension.key);
      dimensions.push({ key: dimension.key, label: dimension.label });
    }
  }
  return dimensions;
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

export function buildCalibrationTree(
  allRows: CalibrationTreeTarget[],
  state: ExplorerState,
  releaseId?: string,
): CalibrationTreeResponse {
  const { path } = state;
  const options = filterOptions(allRows);
  const filteredRows = applyExplorerFilters(allRows, state.filters);

  if (!path.source || !path.program) {
    const bySource = groupRows(filteredRows, (row) => String(row.source ?? "other") || "other");
    const groups = [...bySource.entries()]
      .map(([source, sourceRows]) => {
        const byProgram = groupRows(sourceRows, programId);
        const nodes = sortNodes(
          [...byProgram.entries()].map(([program, rows]) =>
            node(
              program,
              program,
              "program",
              { kind: "program", source, value: program },
              rows,
            ),
          ),
        );
        return {
          id: source,
          label: humanize(source),
          nodes,
          metrics: calibrationTreeMetrics(sourceRows),
        };
      })
      .sort(
        (left, right) =>
          right.metrics.nTargets - left.metrics.nTargets || left.id.localeCompare(right.id),
      );
    return {
      releaseId,
      path,
      currentLevel: { kind: "overview", label: "Programs" },
      groups,
      dimensionOrder: [],
      filterOptions: options,
      filteredMetrics: calibrationTreeMetrics(filteredRows),
    };
  }

  const programRows = allRows.filter(
    (row) => String(row.source ?? "other") === path.source && programId(row) === path.program,
  );
  const filteredProgramRows = applyExplorerFilters(programRows, state.filters);
  if (!path.measure) {
    const byMeasure = groupRows(
      filteredProgramRows,
      (row) => String(row.measure ?? "").trim() || MISSING_VALUE,
    );
    const nodes = [...byMeasure.entries()]
      .map(([measure, rows]) =>
        node(
          measure,
          measure === MISSING_VALUE ? "Not specified" : humanize(measure === "total" ? "amount" : measure),
          "measure",
          { kind: "measure", value: measure },
          rows,
        ),
      )
      .sort((left, right) => {
        const rank = (value: string) => (value === "count" ? 0 : value === "total" ? 1 : 2);
        return rank(left.id) - rank(right.id) || left.label.localeCompare(right.label);
      });
    return {
      releaseId,
      path,
      currentLevel: { kind: "measure", label: "Measure" },
      groups: [{ id: path.program, label: path.program, nodes, metrics: calibrationTreeMetrics(filteredProgramRows) }],
      dimensionOrder: [],
      filterOptions: options,
      filteredMetrics: calibrationTreeMetrics(filteredProgramRows),
    };
  }

  const measureRows = programRows.filter(
    (row) => (String(row.measure ?? "").trim() || MISSING_VALUE) === path.measure,
  );
  const dimensionOrder = orderedBreakdownDimensions(measureRows);
  let scopedRows = measureRows;
  for (const selection of path.dimensions) {
    scopedRows = scopedRows.filter(
      (row) => rowDimensionValue(row, selection.key) === selection.value,
    );
  }
  scopedRows = applyExplorerFilters(scopedRows, state.filters);

  const nextDimension = dimensionOrder[path.dimensions.length];
  if (nextDimension) {
    const byValue = groupRows(scopedRows, (row) => rowDimensionValue(row, nextDimension.key));
    const nodes = sortNodes(
      [...byValue.entries()].map(([value, rows]) =>
        node(
          value,
          value === MISSING_VALUE ? "Not specified" : value,
          "dimension_value",
          {
            kind: "dimension_value",
            key: nextDimension.key,
            label: nextDimension.label,
            value,
          },
          rows,
        ),
      ),
    );
    return {
      releaseId,
      path,
      currentLevel: { kind: "dimension", ...nextDimension },
      groups: [{ id: nextDimension.key, label: nextDimension.label, nodes, metrics: calibrationTreeMetrics(scopedRows) }],
      dimensionOrder,
      filterOptions: options,
      filteredMetrics: calibrationTreeMetrics(scopedRows),
    };
  }

  const nodes = scopedRows
    .map((row, index) => {
      const id = String(row.name ?? row.base_name ?? `target-${index}`);
      return node(
        id,
        String(row.breakdown ?? row.name ?? row.base_name ?? `Target ${index + 1}`),
        "target",
        { kind: "target", value: id },
        [row],
        row,
      );
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  return {
    releaseId,
    path,
    currentLevel: { kind: "target", label: "Targets" },
    groups: [{ id: "targets", label: "Targets", nodes, metrics: calibrationTreeMetrics(scopedRows) }],
    dimensionOrder,
    filterOptions: options,
    filteredMetrics: calibrationTreeMetrics(scopedRows),
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
