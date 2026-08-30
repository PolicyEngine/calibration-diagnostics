"use client";

import { useMemo, useState } from "react";
import { Button } from "@policyengine/ui-kit";

import {
  CalibrationExplorerDataPrefetch,
  CalibrationExplorerMap,
} from "@/components/microcosm/calibration-explorer-map";
import { CalibrationTargetNavigationCards } from "@/components/microcosm/calibration-target-navigation-cards";
import { ArtifactDescriptionBanner } from "@/components/microcosm/artifact-description-banner";
import { WEIGHTED_TARGET_ERROR_HELP } from "@/components/microcosm/calibration-explorer-view";
import {
  selectedReleaseForCountry,
  useCountry,
  type Country,
} from "@/components/layout/country-context";
import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { OverviewMetric } from "@/components/shared/overview-metric";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  releaseSelectOptions,
  useMicrocosm,
  useMicrocosmReleases,
} from "@/lib/api/hooks/use-microcosm";
import { microcosmOverviewIntro } from "@/lib/microcosm/presentation";
import {
  microcosmPublicationUrl,
  microcosmSourceAttribution,
} from "@/lib/microcosm/source-attribution";

function formatPublishedAt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type LossKind = "normalized_target_loss" | "raw_optimizer_objective" | undefined;

function isNormalizedLoss(kind: LossKind): boolean {
  return kind === "normalized_target_loss";
}

function fmtLoss(value: number | null | undefined, kind: LossKind): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (isNormalizedLoss(kind)) return fmt(value, { pct: true, digits: 2 });
  if (value === 0) return "0";
  return value.toExponential(3).replace("e+", "e");
}

export function MicrocosmOverviewView({
  initialCountry = "us",
  initialRelease = "",
}: {
  initialCountry?: Country;
  initialRelease?: string;
}) {
  const { country } = useCountry();
  const [releaseSelection, setReleaseSelection] = useState({
    country: initialCountry,
    value: initialRelease,
  });
  const release = selectedReleaseForCountry(country, releaseSelection);
  const [pageIntroHeight, setPageIntroHeight] = useState(0);
  const { data: releaseData } = useMicrocosmReleases();
  const { data, isLoading, error } = useMicrocosm(release || undefined);

  const releaseOptions = useMemo(() => releaseSelectOptions(releaseData), [releaseData]);

  if (isLoading) {
    return (
      <>
        <CalibrationExplorerDataPrefetch release={release || undefined} />
        <LoadingBlock label="Loading microcosm release…" />
      </>
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        title="Microcosm release data unavailable"
        description={error instanceof Error ? error.message : "Unknown error."}
      />
    );
  }

  const cal = data.calibration ?? { available: false };
  const totalTargets = cal.total_targets ?? 0;
  const includedTargets = cal.included_target_count ?? totalTargets;
  const lossKind = cal.loss_kind;
  const normalizedLoss = isNormalizedLoss(lossKind);
  const diagnosticsStatus = cal.diagnostics_status ?? "ok";
  const isNonDefault = cal.is_local_area === true || cal.is_default === false;
  const sourceAttribution = microcosmSourceAttribution(
    country,
    data.source_repo,
    cal.country?.repository_visibility,
  );
  const publicationUrl = microcosmPublicationUrl(data.source_repo, data.release_id);
  const overviewIntro = microcosmOverviewIntro(country, cal.presentation);

  return (
    <div className="flex flex-col gap-5">
      <CalibrationExplorerDataPrefetch release={release || undefined} />
      <PageHeader
        eyebrow="Microcosm · calibration fit"
        title="What the data is anchored to"
        description={
          <>
            {overviewIntro} Data is built live from{" "}
            {sourceAttribution.href ? (
              <a
                className="underline decoration-dotted underline-offset-2"
                href={sourceAttribution.href}
                target="_blank"
                rel="noreferrer"
              >
                {sourceAttribution.label}
              </a>
            ) : (
              sourceAttribution.label
            )}
            .
          </>
        }
        actions={
          <>
            <ToolbarSelect
              label="Release"
              value={release}
              onChange={(value) => setReleaseSelection({ country, value })}
              options={releaseOptions}
            />
            <Button
              asChild
              variant="outline"
              className="border-primary bg-background text-primary hover:bg-primary/5"
            >
              <a href={publicationUrl} target="_blank" rel="noopener noreferrer">
                View on Hugging Face
              </a>
            </Button>
          </>
        }
        onHeightChange={setPageIntroHeight}
      />

      <ArtifactDescriptionBanner description={cal.description} />

      {isNonDefault ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/80 bg-card px-4 py-3 shadow-[var(--elev-1)]">
          <StatusPill tone="warning">
            {cal.is_local_area ? "Non-default · local area · experimental" : "Non-default release"}
          </StatusPill>
          <p className="text-sm text-muted-foreground">
            {cal.dataset_role ? `Role ${cal.dataset_role}. ` : ""}
            This release is calibrated to a different target surface than the certified national
            default, so its loss and fit are not comparable across releases.
          </p>
        </div>
      ) : null}

      {diagnosticsStatus !== "ok" ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--warn)] bg-card px-4 py-3 shadow-[var(--elev-1)]"
        >
          <StatusPill tone="warning">
            {diagnosticsStatus === "empty" ? "No target rows" : "Diagnostics incompatible"}
          </StatusPill>
          <p className="text-sm text-muted-foreground">
            {diagnosticsStatus === "empty"
              ? "This release's calibration diagnostics declare no target rows, so there is nothing to display. The dataset may still be valid — inspect its files on Hugging Face."
              : "This release's calibration diagnostics use a schema this dashboard does not recognize, so per-target fit can't be shown. This is a display limitation, not necessarily a bad release — inspect its files on Hugging Face."}
          </p>
        </div>
      ) : null}

      <SectionCard title="Calibration overview" padded={false}>
        <div className="mx-3 flex divide-x divide-border/70">
          <OverviewMetric
            label={
              <HelpHint
                label={normalizedLoss ? "Weighted target error" : "Raw optimizer loss"}
                tooltip={
                  normalizedLoss
                    ? WEIGHTED_TARGET_ERROR_HELP
                    : "Raw optimizer loss reported by this release. Its scale is producer-defined and is not a percentage."
                }
                interaction="click"
                underline={false}
                inheritTypography
              />
            }
            value={fmtLoss(cal.final_loss, lossKind)}
          />
          <OverviewMetric
            label="Targets"
            value={diagnosticsStatus === "incompatible" ? "—" : fmt(includedTargets, { digits: 0 })}
          />
          <OverviewMetric
            label={
              <HelpHint
                label="Within 10% of target"
                tooltip="Share of calibration targets whose final aggregate is within 10% of the target value."
                interaction="click"
                underline={false}
                inheritTypography
              />
            }
            value={fmt(cal.fraction_within_10pct, { pct: true, digits: 1 })}
          />
          <OverviewMetric
            label={
              <HelpHint
                label="Weighted synthetic households"
                tooltip="Synthetic households with a non-zero calibrated weight in this release."
                interaction="click"
                underline={false}
                inheritTypography
              />
            }
            value={cal.n_nonzero == null ? "—" : fmtCompact(cal.n_nonzero)}
          />
          <OverviewMetric label="Published" value={formatPublishedAt(data.updated_at)} />
        </div>
      </SectionCard>

      <SectionCard title="Calibration map">
        <CalibrationExplorerMap
          release={release || undefined}
          pageIntroHeight={pageIntroHeight}
        />
      </SectionCard>

      <SectionCard title="Calibration target details">
        <CalibrationTargetNavigationCards release={release || undefined} />
      </SectionCard>

      <SectionCard title="Limitations">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {data.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
