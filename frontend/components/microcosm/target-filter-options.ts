import { explorerGeographyLevelLabel } from "@/components/microcosm/calibration-explorer-view";
import { sourceLabel } from "@policyengine/calibration-tree/source-label";

export interface TargetFilterOption {
  value: string;
  label: string;
}

const ANY: TargetFilterOption = { value: "", label: "Any" };

// The Source filter's options. Each value stays the raw source id the API
// filters on; its label is the one the statistic picker shows: the release's
// own source label when a category carries one, else the dashboard's.
export function sourceFilterOptions(
  sources: readonly string[],
  variables: readonly { source: string; source_label?: string | null }[],
): TargetFilterOption[] {
  const releaseLabels = new Map<string, string>();
  for (const variable of variables) {
    if (variable.source_label && !releaseLabels.has(variable.source)) {
      releaseLabels.set(variable.source, variable.source_label);
    }
  }
  return [
    ANY,
    ...sources.map((value) => ({
      value,
      label: releaseLabels.get(value) ?? sourceLabel(value),
    })),
  ];
}

// The Level filter's options, named as the calibration map's level filter
// names them.
export function levelFilterOptions(levels: readonly string[]): TargetFilterOption[] {
  return [
    ANY,
    ...levels.map((value) => ({ value, label: explorerGeographyLevelLabel(value) })),
  ];
}
