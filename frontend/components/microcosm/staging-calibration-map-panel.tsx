"use client";

import { useState } from "react";

import { CalibrationExplorerMap } from "@/components/microcosm/calibration-explorer-map";
import { StagingTargetChangeMap } from "@/components/microcosm/staging-target-change-map";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { SectionCard } from "@/components/shared/section-card";
import type { MicrocosmComparisonRow } from "@/lib/api/hooks/use-microcosm";
import { targetChangeMapIdentity } from "@/lib/microcosm/target-change-visualization";

type CalibrationMapView = "candidate" | "comparison";

function CalibrationMapViewSelect({
  value,
  onChange,
}: {
  value: CalibrationMapView;
  onChange: (value: CalibrationMapView) => void;
}) {
  const options: Array<{ value: CalibrationMapView; label: string }> = [
    { value: "candidate", label: "Candidate fit" },
    { value: "comparison", label: "Change from current release" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Calibration map view"
      className="flex rounded-lg border border-border bg-muted/40 p-1"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`h-8 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors ${
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function StagingCalibrationMapPanel({
  runId,
  comparisonReleaseId,
  comparisonRows,
  weightedTargetErrorChange,
  pageIntroHeight,
  comparisonLoading,
  comparisonError,
  comparisonDetail,
}: {
  runId: string;
  comparisonReleaseId?: string;
  comparisonRows?: MicrocosmComparisonRow[];
  weightedTargetErrorChange: number | null;
  pageIntroHeight: number;
  comparisonLoading: boolean;
  comparisonError?: unknown;
  comparisonDetail?: string | null;
}) {
  const [view, setView] = useState<CalibrationMapView>("candidate");
  return (
    <SectionCard
      title="Calibration map"
      actions={<CalibrationMapViewSelect value={view} onChange={setView} />}
    >
      {view === "candidate" ? (
        <CalibrationExplorerMap
          key={`candidate-fit:${runId}`}
          stagingRunId={runId}
          stagingComparison={
            comparisonReleaseId
              ? {
                  releaseId: comparisonReleaseId,
                  rows: comparisonRows ?? [],
                  weightedTargetErrorChange,
                }
              : undefined
          }
          pageIntroHeight={pageIntroHeight}
        />
      ) : comparisonReleaseId ? (
        <StagingTargetChangeMap
          key={targetChangeMapIdentity(runId, comparisonReleaseId)}
          runId={runId}
          releaseId={comparisonReleaseId}
          weightedTargetErrorChange={weightedTargetErrorChange}
        />
      ) : comparisonLoading ? (
        <LoadingBlock
          label="Loading calibration diagnostics for the target error comparison…"
          height="h-40"
        />
      ) : (
        <EmptyState
          title="Target error comparison unavailable"
          description={
            comparisonError instanceof Error
              ? comparisonError.message
              : comparisonDetail ??
                "The calibration diagnostics are available, but the comparison could not be loaded."
          }
          variant="compact"
        />
      )}
    </SectionCard>
  );
}
