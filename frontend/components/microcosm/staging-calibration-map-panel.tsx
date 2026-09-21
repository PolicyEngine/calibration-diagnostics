"use client";

import { useEffect, useMemo, useState } from "react";

import { CalibrationExplorerMap } from "@/components/microcosm/calibration-explorer-map";
import { StagingTargetChangeMap } from "@/components/microcosm/staging-target-change-map";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { SectionCard } from "@/components/shared/section-card";
import {
  useMicrocosmCalibrationBuildManifest,
  type MicrocosmCalibrationBuild,
  type MicrocosmComparisonRow,
} from "@/lib/api/hooks/use-microcosm";
import {
  calibrationBuildManifestState,
  calibrationBuildsNewestFirst,
} from "@/lib/microcosm/calibration-selection";
import { targetChangeMapIdentity } from "@/lib/microcosm/target-change-visualization";

type CalibrationMapView = "candidate" | "comparison";

function buildLabel(build: MicrocosmCalibrationBuild): string {
  const kind = build.kind === "release" ? "Release" : "Staging";
  return `${kind}: ${build.label}`;
}

function BuildSelect({
  label,
  value,
  builds,
  liveLabel,
  onChange,
}: {
  label: string;
  value: string;
  builds: MicrocosmCalibrationBuild[];
  liveLabel?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <span className="shrink-0 font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-foreground"
      >
        {liveLabel ? <option value="">{liveLabel}</option> : null}
        {builds.map((build) => (
          <option key={build.buildArtifactId} value={build.buildArtifactId}>
            {buildLabel(build)}
          </option>
        ))}
      </select>
    </label>
  );
}

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
  const {
    data: buildManifest,
    isLoading: buildManifestLoading,
    error: buildManifestError,
    refetch: refetchBuildManifest,
  } = useMicrocosmCalibrationBuildManifest();
  const builds = useMemo(
    () => calibrationBuildsNewestFirst(buildManifest?.builds ?? []),
    [buildManifest?.builds],
  );
  const buildManifestState = calibrationBuildManifestState({
    hasData: Boolean(buildManifest),
    isLoading: buildManifestLoading,
    hasError: Boolean(buildManifestError),
    buildCount: builds.length,
  });
  const selectedRunBuild = builds.find(
    (build) => build.stagingRunId === runId,
  );
  const [currentBuildArtifactId, setCurrentBuildArtifactId] = useState("");
  const [candidateBuildArtifactId, setCandidateBuildArtifactId] = useState("");

  useEffect(() => {
    setCurrentBuildArtifactId((current) =>
      builds.some((build) => build.buildArtifactId === current)
        ? current
        : buildManifest?.latestReleaseBuildArtifactId ??
          builds[0]?.buildArtifactId ??
          "",
    );
    setCandidateBuildArtifactId((candidate) =>
      candidate && builds.some((build) => build.buildArtifactId === candidate)
        ? candidate
        : selectedRunBuild?.buildArtifactId ?? "",
    );
  }, [buildManifest?.latestReleaseBuildArtifactId, builds, selectedRunBuild?.buildArtifactId]);

  const immutableComparison = Boolean(
    currentBuildArtifactId && candidateBuildArtifactId,
  );
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
      ) : (
        <div className="flex flex-col gap-4">
          {buildManifestState === "loading" ? (
            <LoadingBlock
              label="Loading published calibration builds…"
              height="h-24"
            />
          ) : buildManifestState === "error" ? (
            <EmptyState
              title="Published calibration builds unavailable"
              description={
                buildManifestError instanceof Error
                  ? buildManifestError.message
                  : "The published calibration build manifest could not be loaded."
              }
              actions={
                <button
                  type="button"
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  onClick={() => void refetchBuildManifest()}
                >
                  Try again
                </button>
              }
              variant="compact"
            />
          ) : buildManifestState === "empty" ? (
            <EmptyState
              title="No published calibration builds"
              description="The build manifest loaded successfully but contains no builds for this country."
              variant="compact"
            />
          ) : buildManifestState === "ready" ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 p-3 md:flex-row">
              <BuildSelect
                label="From"
                value={currentBuildArtifactId}
                builds={builds}
                onChange={setCurrentBuildArtifactId}
              />
              <BuildSelect
                label="To"
                value={candidateBuildArtifactId}
                builds={builds}
                liveLabel={`Selected live candidate: ${runId}`}
                onChange={setCandidateBuildArtifactId}
              />
            </div>
          ) : null}
          {comparisonReleaseId || currentBuildArtifactId ? (
            <StagingTargetChangeMap
              key={immutableComparison
                ? targetChangeMapIdentity(
                    currentBuildArtifactId,
                    candidateBuildArtifactId,
                  )
                : targetChangeMapIdentity(
                    currentBuildArtifactId || comparisonReleaseId || "",
                    runId,
                  )}
              runId={immutableComparison ? undefined : runId}
              releaseId={immutableComparison ? undefined : comparisonReleaseId}
              currentBuildArtifactId={currentBuildArtifactId || undefined}
              candidateBuildArtifactId={
                immutableComparison ? candidateBuildArtifactId : undefined
              }
              weightedTargetErrorChange={
                immutableComparison ? null : weightedTargetErrorChange
              }
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
        </div>
      )}
    </SectionCard>
  );
}
