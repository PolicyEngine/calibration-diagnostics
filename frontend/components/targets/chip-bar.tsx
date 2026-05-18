"use client";

import { Badge } from "@policyengine/ui-kit";
import {
  ERROR_BUCKET_LABELS,
  STATUS_LABELS,
  useTargetFilters,
  type ErrorBucket,
} from "@/lib/target-filters-context";
import { STATE_FIPS_TO_NAME } from "@/lib/geo-names";

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

export function TargetChipBar() {
  const {
    filters,
    setFilters,
    toggleVariable,
    toggleGeoLevel,
    toggleErrorBucket,
    clearAll,
    hasActiveFilters,
  } = useTargetFilters();

  if (!hasActiveFilters && !filters.search) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Filters
      </span>
      {filters.search && (
        <Chip
          label={`search: "${filters.search}"`}
          onRemove={() => setFilters({ search: "" })}
        />
      )}
      {filters.variables.map((v) => (
        <Chip
          key={`var-${v}`}
          label={`variable: ${v}`}
          onRemove={() => toggleVariable(v)}
        />
      ))}
      {filters.geoLevels.map((g) => (
        <Chip
          key={`geo-${g}`}
          label={`geo: ${g}`}
          onRemove={() => toggleGeoLevel(g)}
        />
      ))}
      {filters.stateFipsList.map((fips) => (
        <Chip
          key={`state-${fips}`}
          label={`state: ${STATE_FIPS_TO_NAME[fips] ?? fips}`}
          onRemove={() =>
            setFilters({
              stateFipsList: filters.stateFipsList.filter((f) => f !== fips),
            })
          }
        />
      ))}
      {filters.sources.map((s) => (
        <Chip
          key={`src-${s}`}
          label={`source: ${s}`}
          onRemove={() =>
            setFilters({ sources: filters.sources.filter((x) => x !== s) })
          }
        />
      ))}
      {filters.errorBuckets.map((b) => (
        <Chip
          key={`bucket-${b}`}
          label={`error: ${ERROR_BUCKET_LABELS[b as ErrorBucket] ?? b}`}
          onRemove={() => toggleErrorBucket(b as ErrorBucket)}
        />
      ))}
      {filters.status !== "all" && (
        <Chip
          label={`targets: ${STATUS_LABELS[filters.status]}`}
          onRemove={() => setFilters({ status: "all" })}
        />
      )}
      <button
        type="button"
        onClick={clearAll}
        className="ml-auto text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
