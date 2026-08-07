import type { ExplorerNodeSelection } from "./calibration-explorer";
import type {
  CalibrationTreeGroup,
  CalibrationTreeMetrics,
  CalibrationTreeNode,
  CalibrationTreeSizeMode,
  CalibrationTreeTarget,
} from "./calibration-tree";

// Keep these aligned with the original calibration map. They represent roughly
// a 51px square for groups and a 28px square for nodes.
export const MIN_CALIBRATION_GROUP_AREA = 2600;
export const MIN_CALIBRATION_NODE_AREA = 780;

export interface CalibrationTreemapNode {
  id: string;
  label: string;
  kind: CalibrationTreeNode["kind"] | "grouped";
  selection?: ExplorerNodeSelection;
  metrics: CalibrationTreeMetrics;
  target?: CalibrationTreeTarget;
  expandedGroups?: CalibrationTreeGroup[];
}

export interface CalibrationTreemapGroup {
  id: string;
  label: string;
  nodes: CalibrationTreemapNode[];
  metrics: CalibrationTreeMetrics;
  synthetic?: boolean;
}

function metricValue(
  metrics: CalibrationTreeMetrics,
  mode: CalibrationTreeSizeMode,
): number {
  if (mode === "targets") return metrics.nTargets;
  if (mode === "loss") return metrics.loss;
  return metrics.huberErrorIntensity ?? 0;
}

function effectiveMetricValues(
  items: Array<{ metrics: CalibrationTreeMetrics }>,
  mode: CalibrationTreeSizeMode,
): number[] {
  const values = items.map((item) => metricValue(item.metrics, mode));
  return values.some((value) => value > 0)
    ? values
    : items.map((item) => item.metrics.nTargets);
}

function weightedError(
  metrics: CalibrationTreeMetrics[],
  key: "meanAbsRelativeError" | "medianAbsRelativeError",
): number | null {
  let totalWeight = 0;
  let total = 0;
  for (const item of metrics) {
    const value = item[key];
    if (value != null && item.scored > 0) {
      total += value * item.scored;
      totalWeight += item.scored;
    }
  }
  return totalWeight ? total / totalWeight : null;
}

export function aggregateCalibrationTreeMetrics(
  items: Array<{ metrics: CalibrationTreeMetrics }>,
): CalibrationTreeMetrics {
  const metrics = items.map((item) => item.metrics);
  const scored = metrics.reduce((sum, item) => sum + item.scored, 0);
  const huberLoss = metrics.reduce((sum, item) => sum + item.huberLoss, 0);
  return {
    nTargets: metrics.reduce((sum, item) => sum + item.nTargets, 0),
    scored,
    within10Pct: metrics.reduce((sum, item) => sum + item.within10Pct, 0),
    loss: metrics.reduce((sum, item) => sum + item.loss, 0),
    huberLoss,
    huberErrorIntensity: scored ? Math.sqrt((2 * huberLoss) / scored) : null,
    meanAbsRelativeError: weightedError(metrics, "meanAbsRelativeError"),
    medianAbsRelativeError: weightedError(metrics, "medianAbsRelativeError"),
  };
}

function groupedNode(
  id: string,
  label: string,
  expandedGroups: CalibrationTreeGroup[],
): CalibrationTreemapNode {
  return {
    id,
    label,
    kind: "grouped",
    metrics: aggregateCalibrationTreeMetrics(expandedGroups),
    expandedGroups,
  };
}

function condenseNodes(
  group: CalibrationTreeGroup,
  mode: CalibrationTreeSizeMode,
  projectedGroupArea: number,
): CalibrationTreemapNode[] {
  const values = effectiveMetricValues(group.nodes, mode);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return group.nodes;

  const large: CalibrationTreeNode[] = [];
  const small: CalibrationTreeNode[] = [];
  group.nodes.forEach((item, index) => {
    const projectedArea = (values[index] / total) * projectedGroupArea;
    (projectedArea >= MIN_CALIBRATION_NODE_AREA ? large : small).push(item);
  });
  if (small.length <= 1) return group.nodes;

  const metrics = aggregateCalibrationTreeMetrics(small);
  const expandedGroup: CalibrationTreeGroup = {
    ...group,
    nodes: small,
    metrics,
  };
  return [
    ...large,
    groupedNode(
      `__grouped_nodes__:${group.id}`,
      `+${small.length} more`,
      [expandedGroup],
    ),
  ];
}

/**
 * Applies the original calibration map's projected-area thresholds while
 * retaining the exact groups and nodes represented by every synthetic tile.
 */
export function condenseCalibrationTreemap(
  groups: CalibrationTreeGroup[],
  mode: CalibrationTreeSizeMode,
  width: number,
  height: number,
): CalibrationTreemapGroup[] {
  const canvasArea = Math.max(width, 0) * Math.max(height, 0);
  const groupValues = effectiveMetricValues(groups, mode);
  const total = groupValues.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || canvasArea <= 0) return groups;

  const large: Array<{ group: CalibrationTreeGroup; value: number }> = [];
  const small: CalibrationTreeGroup[] = [];
  groups.forEach((group, index) => {
    const projectedArea = (groupValues[index] / total) * canvasArea;
    if (projectedArea >= MIN_CALIBRATION_GROUP_AREA) {
      large.push({ group, value: groupValues[index] });
    } else {
      small.push(group);
    }
  });

  const kept: CalibrationTreemapGroup[] = large.map(({ group, value }) => ({
    ...group,
    nodes: condenseNodes(group, mode, (value / total) * canvasArea),
  }));

  if (small.length < 2) {
    return [
      ...kept,
      ...small.map((group) => ({
        ...group,
        nodes: condenseNodes(
          group,
          mode,
          (groupValues[groups.indexOf(group)] / total) * canvasArea,
        ),
      })),
    ];
  }

  const metrics = aggregateCalibrationTreeMetrics(small);
  return [
    ...kept,
    {
      id: "__other_groups__",
      label: "Other sources",
      metrics,
      synthetic: true,
      nodes: [
        groupedNode(
          "__grouped_groups__",
          `Other sources (${small.length})`,
          small,
        ),
      ],
    },
  ];
}

export function expandedGroupsForNode(
  node: CalibrationTreemapNode,
): CalibrationTreeGroup[] | null {
  return node.kind === "grouped" && node.expandedGroups
    ? node.expandedGroups
    : null;
}
