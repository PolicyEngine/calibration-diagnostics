"use client";

import { explorerGeographyLevelLabel } from "@/components/microcosm/calibration-explorer-view";
import { humanizeName } from "@/components/shared/format";
import {
  createExplorerFilters,
  type ComparisonFit,
  type ExplorerFilters,
  type ExplorerState,
} from "@/lib/microcosm/calibration-explorer";
import type { CalibrationTreeResponse } from "@/lib/microcosm/calibration-tree";

const FIT_BAND_LABELS: Record<string, string> = {
  "0_5": "0–5%",
  "5_10": "5–10%",
  "10_20": "10–20%",
  "20_40": "20–40%",
  "40_plus": "40%+",
  unscored: "Unscored",
};

const COMPARISON_FIT_LABELS: Record<ComparisonFit, string> = {
  improved: "Improved",
  regressed: "Regressed",
  unchanged: "Unchanged",
  not_applicable: "Not applicable",
};

const STATUS_LABELS: Record<string, string> = {
  included: "Included",
  skipped: "Skipped",
};

function displayValue(value: string): string {
  return humanizeName(value) || value;
}

function MultiSelectFilter({
  label,
  options,
  selected,
  labelOf = displayValue,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  labelOf?: (value: string) => string;
  onChange: (values: string[]) => void;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
        {label}{selected.length ? ` · ${selected.length}` : " · All"} ▾
      </summary>
      <div className="absolute left-0 top-full z-40 mt-1 max-h-64 min-w-56 overflow-auto rounded-lg border border-border bg-card p-2 shadow-xl">
        {options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
          >
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() =>
                onChange(
                  selected.includes(option)
                    ? selected.filter((value) => value !== option)
                    : [...selected, option],
                )
              }
            />
            <span>{labelOf(option)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function FilterBar({
  data,
  state,
  onFilters,
}: {
  data: CalibrationTreeResponse;
  state: ExplorerState;
  onFilters: (filters: ExplorerFilters) => void;
}) {
  const filter = <K extends keyof ExplorerFilters>(key: K, values: ExplorerFilters[K]) =>
    onFilters({ ...state.filters, [key]: values });
  const active = [
    ...state.filters.geographyLevels.map((value) => ({
      key: "geographyLevels" as const,
      value,
      label: `Level: ${explorerGeographyLevelLabel(value)}`,
    })),
    ...state.filters.geographies.map((value) => ({
      key: "geographies" as const,
      value,
      label: `Place: ${displayValue(value)}`,
    })),
    ...state.filters.fitBands.map((value) => ({
      key: "fitBands" as const,
      value,
      label: `Fit band: ${FIT_BAND_LABELS[value]}`,
    })),
    ...state.filters.comparisonFits.map((value) => ({
      key: "comparisonFits" as const,
      value,
      label: `Fit: ${COMPARISON_FIT_LABELS[value]}`,
    })),
    ...state.filters.calibrationStatuses.map((value) => ({
      key: "calibrationStatuses" as const,
      value,
      label: `Status: ${STATUS_LABELS[value]}`,
    })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter
          label="Geography level"
          options={data.filterOptions.geographyLevels}
          selected={state.filters.geographyLevels}
          labelOf={explorerGeographyLevelLabel}
          onChange={(values) => filter("geographyLevels", values)}
        />
        <MultiSelectFilter
          label="Geography"
          options={data.filterOptions.geographies}
          selected={state.filters.geographies}
          onChange={(values) => filter("geographies", values)}
        />
        <MultiSelectFilter
          label="Fit band"
          options={data.filterOptions.fitBands}
          selected={state.filters.fitBands}
          labelOf={(value) => FIT_BAND_LABELS[value] ?? value}
          onChange={(values) => filter("fitBands", values as ExplorerFilters["fitBands"])}
        />
        {data.filterOptions.comparisonFits.length > 0 ? (
          <MultiSelectFilter
            label="Fit"
            options={data.filterOptions.comparisonFits}
            selected={state.filters.comparisonFits}
            labelOf={(value) =>
              COMPARISON_FIT_LABELS[value as ComparisonFit] ?? displayValue(value)
            }
            onChange={(values) =>
              filter("comparisonFits", values as ExplorerFilters["comparisonFits"])
            }
          />
        ) : null}
        <MultiSelectFilter
          label="Calibration status"
          options={data.filterOptions.calibrationStatuses}
          selected={state.filters.calibrationStatuses}
          labelOf={(value) => STATUS_LABELS[value] ?? displayValue(value)}
          onChange={(values) =>
            filter("calibrationStatuses", values as ExplorerFilters["calibrationStatuses"])
          }
        />
        {active.length > 0 ? (
          <button
            type="button"
            onClick={() => onFilters(createExplorerFilters())}
            className="ml-auto cursor-pointer text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {active.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {active.map((item) => (
            <button
              type="button"
              key={`${item.key}:${item.value}`}
              onClick={() =>
                filter(
                  item.key,
                  state.filters[item.key].filter((value) => value !== item.value) as never,
                )
              }
              className="cursor-pointer rounded-full border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${item.label} filter`}
            >
              {item.label} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CalibrationExplorerFilterMenu({
  data,
  state,
  onFilters,
}: {
  data: CalibrationTreeResponse;
  state: ExplorerState;
  onFilters: (filters: ExplorerFilters) => void;
}) {
  const activeCount =
    state.filters.geographyLevels.length +
    state.filters.geographies.length +
    state.filters.fitBands.length +
    state.filters.comparisonFits.length +
    state.filters.calibrationStatuses.length;

  return (
    <details className="group relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/40 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>Filters{activeCount ? ` · ${activeCount}` : ""}</span>
        <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 shadow-xl">
        <FilterBar data={data} state={state} onFilters={onFilters} />
      </div>
    </details>
  );
}
