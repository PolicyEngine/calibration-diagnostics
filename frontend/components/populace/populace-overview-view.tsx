"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { CalibrationMap } from "@/components/populace/calibration-map";
import { useCountry } from "@/components/layout/country-context";
import { apiGet } from "@/lib/api/client";
import { withBasePath } from "@/lib/base-path";
import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  releaseSelectOptions,
  usePopulace,
  usePopulaceReleases,
  usePopulaceTargetTreemap,
} from "@/lib/api/hooks/use-populace";
import type {
  GeographyCoverageBlock,
  PopulaceTreemapResponse,
} from "@/lib/api/hooks/use-populace";

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
  if (value === 0) return "0";
  if (isNormalizedLoss(kind)) return fmt(value, { digits: value < 1 ? 4 : 3 });
  return value.toExponential(3).replace("e+", "e");
}

export function PopulaceOverviewView() {
  const { country } = useCountry();
  const queryClient = useQueryClient();
  const [release, setRelease] = useState("");
  const [mapBreakdown, setMapBreakdown] = useState<"program" | "geography">("program");
  const { data: releaseData } = usePopulaceReleases();
  const { data, isLoading, error } = usePopulace(release || undefined);
  const { data: treemap } = usePopulaceTargetTreemap(
    release || undefined,
    mapBreakdown,
  );

  const releaseOptions = useMemo(() => releaseSelectOptions(releaseData), [releaseData]);
  const activeRelease = release || undefined;

  useEffect(() => {
    if (!treemap?.release_id || mapBreakdown !== "program") return;
    void queryClient.prefetchQuery({
      queryKey: [
        "populace",
        "target-treemap",
        country,
        activeRelease ?? "latest",
        "geography",
      ],
      queryFn: () =>
        apiGet<PopulaceTreemapResponse>("/populace/target-treemap", {
          release: activeRelease,
          breakdown: "geography",
          country,
        }),
      staleTime: 5 * 60 * 1000,
    });
  }, [activeRelease, country, mapBreakdown, queryClient, treemap?.release_id]);

  if (isLoading) return <LoadingBlock label="Loading populace release…" />;
  if (error || !data) {
    return (
      <EmptyState
        title="Populace release data unavailable"
        description={error instanceof Error ? error.message : "Unknown error."}
      />
    );
  }

  const cal = data.calibration ?? { available: false };
  const totalTargets = cal.total_targets ?? 0;
  const includedTargets = cal.included_target_count ?? totalTargets;
  const lossKind = cal.loss_kind;
  const diagnosticsStatus = cal.diagnostics_status ?? "ok";
  const isNonDefault = cal.is_local_area === true || cal.is_default === false;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace · calibration fit"
        title="What the data is anchored to"
        description={
          <>
            Populace reweights survey microdata so it matches thousands of official
            statistics from agencies like{" "}
            {country === "uk" ? "the ONS, OBR, and HMRC" : "the IRS, Census, and CMS"}. Each
            tile below is one of those things we calibrate to —{" "}
            {country === "uk"
              ? "population by region and age, household types, tax receipts"
              : "EITC, population, Medicaid enrollment"}
            . Tile size shows how much we calibrate to it; color shows how closely the
            weighted data matches. Built live from{" "}
            <a
              className="underline decoration-dotted underline-offset-2"
              href={`https://huggingface.co/datasets/${data.source_repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {data.source_repo}
            </a>
            .
          </>
        }
        actions={
          <ToolbarSelect
            label="Release"
            value={release}
            onChange={setRelease}
            options={releaseOptions}
          />
        }
      />

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label={
            <HelpHint
              label="Targets included"
              tooltip="Targets that made it into the active calibration matrix for this release. Ledger facts can be excluded before this stage if they are unsupported or validation-only."
            />
          }
          value={diagnosticsStatus === "incompatible" ? "—" : fmt(includedTargets, { digits: 0 })}
        />
        <KpiCard
          label={
            <HelpHint
              label="Final loss"
              tooltip="Target-normalized calibration loss after reweighting. Lower is better; roughly 0 means the weighted estimates match the target surface."
            />
          }
          value={fmtLoss(cal.final_loss, lossKind)}
        />
        <KpiCard
          label={
            <HelpHint
              label="Within 10% of target"
              tooltip="Share of calibration targets whose final aggregate is within 10% of the target value."
            />
          }
          value={fmt(cal.fraction_within_10pct, { pct: true, digits: 1 })}
        />
        <KpiCard
          label={
            <HelpHint
              label="Records kept"
              tooltip="Records with a non-zero calibrated weight in this release."
            />
          }
          value={cal.n_nonzero == null ? "—" : fmtCompact(cal.n_nonzero)}
        />
        <KpiCard label="Published" value={formatPublishedAt(data.updated_at)} />
      </div>

      <GeographyCoverageSection coverage={cal.geography_coverage ?? null} />

      <SectionCard
        title="Calibration map"
        actions={
          <div className="flex items-center gap-3">
            <a
              href={withBasePath("/populace/targets")}
              className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
            >
              All targets →
            </a>
          </div>
        }
      >
        {treemap ? (
          <CalibrationMap
            data={treemap}
            release={release || undefined}
            breakdown={mapBreakdown}
            onBreakdownChange={setMapBreakdown}
          />
        ) : (
          <LoadingBlock label="Building calibration map…" />
        )}
      </SectionCard>

      <details className="group overflow-hidden rounded-lg border border-border/80 bg-card shadow-[var(--elev-1)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/20 px-5 py-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-foreground">
              Release artifacts
            </div>
            <div className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
              {release ? (
                <>Read live from Hugging Face for the selected release</>
              ) : (
                <>
                  Read live from Hugging Face, resolved through <code>latest.json</code>
                </>
              )}
              {data.updated_at ? ` (published ${data.updated_at})` : ""}.
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-border p-5">
          <table className="w-full text-left text-sm">
            <tbody>
              {data.source_artifacts.map((artifact) => (
                <tr key={artifact.name} className="border-b border-border/60 last:border-b-0">
                  <td className="py-1.5 pr-3 font-medium">{artifact.name}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    <a
                      className="underline decoration-dotted underline-offset-2"
                      href={artifact.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {artifact.path}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 text-xs text-muted-foreground">
            Compatible with{" "}
            {(data.release_manifest.compatible_model_packages ?? [])
              .map((pkg) => `${pkg.name}${pkg.specifier}`)
              .join(", ") || "—"}
            .
          </div>
        </div>
      </details>

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

/** Household-record counts by geography — the release's sub-national
 *  resolution floor. Records, not weights: no calibration can rescue a
 *  geography with too few underlying records (48 districts under 50 in the
 *  2026-07 national-only release blocked district features downstream). */
function GeographyCoverageSection({
  coverage,
}: {
  coverage: {
    unit?: string;
    states?: GeographyCoverageBlock | null;
    congressional_districts?: GeographyCoverageBlock | null;
  } | null;
}) {
  const districts = coverage?.congressional_districts ?? null;
  const states = coverage?.states ?? null;
  if (!districts && !states) return null;
  const under50 = districts?.n_under_50 ?? null;
  const thinnest = districts?.counts
    ? Object.entries(districts.counts)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 10)
    : [];
  return (
    <SectionCard
      title="Geography coverage"
      description="Unweighted household records per geography — the resolution floor for sub-national analysis. Districts need enough records, not just calibrated weights."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Congressional districts"
          value={districts?.n_geographies == null ? "—" : fmt(districts.n_geographies, { digits: 0 })}
        />
        <KpiCard
          label="Median records / district"
          value={districts?.household_records_median == null ? "—" : fmt(districts.household_records_median, { digits: 0 })}
        />
        <KpiCard
          label={
            <HelpHint
              label="Districts under 50 records"
              tooltip="Districts with fewer than 50 household records cannot support district-level rate estimates. Zero here is the readiness bar for congressional-district features."
            />
          }
          value={under50 == null ? "—" : fmt(under50, { digits: 0 })}
        />
        <KpiCard
          label="Min records / state"
          value={states?.household_records_min == null ? "—" : fmt(states.household_records_min, { digits: 0 })}
        />
      </div>
      {thinnest.length > 0 && (under50 ?? 0) > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Thinnest districts
          </div>
          <div className="flex flex-wrap gap-2 text-xs tabular-nums">
            {thinnest.map(([district, count]) => (
              <span
                key={district}
                className={`rounded border border-border px-2 py-0.5 ${
                  count < 50 ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {district}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
