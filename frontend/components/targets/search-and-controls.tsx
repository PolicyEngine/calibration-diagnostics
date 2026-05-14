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

const STATUS_OPTIONS: StatusFilter[] = ["included", "all", "skipped"];

const STATE_OPTIONS = Object.entries(STATE_FIPS_TO_NAME)
  .map(([fips, name]) => ({ value: fips, label: name }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function TargetSearchAndControls() {
  const { filters, setFilters, toggleErrorBucket, toggleGeoLevel, toggleStateFips } =
    useTargetFilters();

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

      <ToolbarSelect
        label="Status"
        value={filters.status}
        options={statusOptions}
        onChange={(v) => setFilters({ status: v as StatusFilter })}
      />
    </div>
  );
}
