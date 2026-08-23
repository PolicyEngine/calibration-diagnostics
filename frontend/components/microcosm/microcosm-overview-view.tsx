"use client";

import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@policyengine/ui-kit";

import {
  CalibrationExplorerDataPrefetch,
  CalibrationExplorerMap,
} from "@/components/microcosm/calibration-explorer-map";
import { ArtifactDescriptionBanner } from "@/components/microcosm/artifact-description-banner";
import { ExternalValidationsPanel } from "@/components/microcosm/external-validations-panel";
import { WEIGHTED_TARGET_ERROR_HELP } from "@/components/microcosm/calibration-explorer-view";
import { useCountry, type Country } from "@/components/layout/country-context";
import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  releaseSelectOptions,
  useMicrocosm,
  useMicrocosmReleases,
} from "@/lib/api/hooks/use-microcosm";
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

const COUNTRY_OVERVIEW_COPY: Record<
  Country,
  { authorities: string; examples: string }
> = {
  us: {
    authorities: "the IRS, the Census Bureau, and CMS",
    examples: "EITC statistics, population, and Medicaid enrollment",
  },
  uk: {
    authorities: "the ONS, OBR, and HMRC",
    examples: "population by region and age, household types, and tax receipts",
  },
  be: {
    authorities: "Statbel, ONSS, JRC, and SFPD",
    examples: "population by region, sex, and age band, tax receipts, and benefit totals",
  },
};

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

function OverviewMetric({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3.5 text-center sm:px-5">
      <div className="flex h-8 items-start justify-center text-[10px] font-semibold uppercase leading-tight tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div
        className="mt-1 truncate text-2xl font-semibold tabular-nums text-foreground"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

export function MicrocosmOverviewView() {
  const { country } = useCountry();
  const [release, setRelease] = useState("");
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
  const sourceAttribution = microcosmSourceAttribution(country, data.source_repo);
  const publicationUrl = microcosmPublicationUrl(data.source_repo, data.release_id);
  const overviewCopy = COUNTRY_OVERVIEW_COPY[country];

  return (
    <div className="flex flex-col gap-5">
      <CalibrationExplorerDataPrefetch release={release || undefined} />
      <PageHeader
        eyebrow="Microcosm · calibration fit"
        title="What the data is anchored to"
        description={
          <>
            Microcosm reweights survey microdata so it matches official statistics
            from agencies like{" "}
            {overviewCopy.authorities}.
            Each tile in the Calibration fit explorer below is a category we calibrate to,
            including{" "}
            {overviewCopy.examples}
            . Data is built live from{" "}
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
              onChange={setRelease}
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

      <ExternalValidationsPanel releaseManifest={data.release_manifest} />

      <SectionCard title="Calibration map">
        <CalibrationExplorerMap
          release={release || undefined}
          pageIntroHeight={pageIntroHeight}
        />
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
