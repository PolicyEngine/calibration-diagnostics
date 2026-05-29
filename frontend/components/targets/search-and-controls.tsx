"use client";

import { Input } from "@policyengine/ui-kit";
import {
  ERROR_BUCKETS,
  ERROR_BUCKET_LABELS,
  GEO_LEVELS,
  GEO_LEVEL_LABELS,
  STATUS_LABELS,
  useTargetFilters,
  type StatusFilter,
} from "@/lib/target-filters-context";
import { STATE_FIPS_TO_NAME } from "@/lib/geo-names";
import { MultiSelectDropdown } from "@/components/shared/multi-select-dropdown";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import { useTargetFacets } from "@/lib/api/hooks/use-targets";

const STATUS_OPTIONS: StatusFilter[] = ["included", "all", "skipped"];

const STATE_OPTIONS = Object.entries(STATE_FIPS_TO_NAME)
  .map(([fips, name]) => ({ value: fips, label: name }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function TargetSearchAndControls() {
  const {
    filters,
    setFilters,
    toggleErrorBucket,
    toggleGeoLevel,
    toggleStateFips,
    toggleSource,
    toggleDatasetFile,
  } = useTargetFilters();
  const facets = useTargetFacets({
    search: filters.search,
    variables: filters.variables,
    geoLevels: filters.geoLevels,
    errorBuckets: filters.errorBuckets,
    sources: filters.sources,
  });
  const sourceOptions = (facets.data?.by_source ?? []).map((s) => ({
    value: s.value,
    label: s.value,
    count: s.count,
  }));
  // Only list bundles the loaded run actually publishes. For a federal-
  // only GHA run, this collapses to a single entry — that's intentional;
  // the dashboard should never offer to filter to a bundle that doesn't
  // exist for the run.
  const datasetFileOptions = (facets.data?.by_dataset_file ?? []).map((d) => ({
    value: d.value,
    label: d.value,
    count: d.count,
  }));
  const onlyOneBundle = datasetFileOptions.length === 1;

  // The state filter only makes sense when state-/district-level targets
  // are in play; for national-only it's a no-op so we dim it.
  const stateApplicable =
    filters.geoLevels.length === 0 ||
    filters.geoLevels.includes("state") ||
    filters.geoLevels.includes("district");

  const geoOptions = GEO_LEVELS.map((g) => ({
    value: g,
    label: GEO_LEVEL_LABELS[g],
  }));

  const errorOptions = ERROR_BUCKETS.map((b) => ({
    value: b,
    label: ERROR_BUCKET_LABELS[b],
  }));

  const statusOptions = STATUS_OPTIONS.map((s) => ({
    value: s,
    label: STATUS_LABELS[s],
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-[280px]">
        <Input
          placeholder="Search target name, variable, or domain…"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </div>

      <MultiSelectDropdown
        label="Geo"
        options={geoOptions}
        selected={filters.geoLevels}
        onToggle={(v) => toggleGeoLevel(v)}
        onClear={() => setFilters({ geoLevels: [] })}
      />

      <MultiSelectDropdown
        label="State"
        options={STATE_OPTIONS}
        selected={filters.stateFipsList.map(String)}
        onToggle={(v) => toggleStateFips(Number(v))}
        onClear={() => setFilters({ stateFipsList: [] })}
        disabled={!stateApplicable}
      />

      <MultiSelectDropdown
        label="Error"
        options={errorOptions}
        selected={filters.errorBuckets}
        onToggle={(v) => toggleErrorBucket(v as never)}
        onClear={() => setFilters({ errorBuckets: [] })}
      />

      <MultiSelectDropdown
        label="Source"
        options={sourceOptions}
        selected={filters.sources}
        onToggle={(v) => toggleSource(v)}
        onClear={() => setFilters({ sources: [] })}
      />

      <div className="flex items-center gap-2">
        <MultiSelectDropdown
          label="Dataset"
          options={datasetFileOptions}
          selected={filters.datasetFiles}
          onToggle={(v) => toggleDatasetFile(v)}
          onClear={() => setFilters({ datasetFiles: [] })}
        />
        {onlyOneBundle && (
          <span
            className="text-[11px] text-muted-foreground"
            title="This run only publishes one calibrated h5; all targets are evaluated against it."
          >
            (1 bundle in this run)
          </span>
        )}
      </div>

      <ToolbarSelect
        label="Status"
        value={filters.status}
        options={statusOptions}
        onChange={(v) => setFilters({ status: v as StatusFilter })}
      />
    </div>
  );
}
