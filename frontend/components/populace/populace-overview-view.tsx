"use client";

import { useMemo, useState } from "react";

import { CalibrationMap } from "@/components/populace/calibration-map";
import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, releaseLabel } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  usePopulace,
  usePopulaceReleases,
  usePopulaceTargetTreemap,
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
  const [release, setRelease] = useState("");
  const { data: releaseData } = usePopulaceReleases();
  const { data, isLoading, error } = usePopulace(release || undefined);
  const { data: treemap } = usePopulaceTargetTreemap(release || undefined);

  const releaseOptions = useMemo(
    () => [
      { value: "", label: "Latest" },
      ...(releaseData?.releases ?? []).map((r) => ({
        value: r.release_id,
        label: releaseLabel(r.release_id, r.date),
      })),
    ],
    [releaseData],
  );

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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace · calibration map"
        title="What the data is anchored to"
        description={
          <>
            Populace reweights survey microdata so it matches thousands of official
            statistics from agencies like the IRS, Census, and CMS. Each tile below is
            one of those things we calibrate to — EITC, population, Medicaid enrollment.
            Tile size shows how much we calibrate to it; color shows how closely the
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label={
            <HelpHint
              label="Targets included"
              tooltip="Targets that made it into the active calibration matrix for this release. Ledger facts can be excluded before this stage if they are unsupported or validation-only."
            />
          }
          value={fmt(includedTargets, { digits: 0 })}
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

      <SectionCard title="Calibration map">
        {treemap ? (
          <CalibrationMap data={treemap} release={release || undefined} />
        ) : (
          <LoadingBlock label="Building calibration map…" />
        )}
      </SectionCard>

      <details className="group overflow-hidden rounded-lg border border-border/80 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/20 px-5 py-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-foreground">
              Release artifacts
            </div>
            <div className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
              Read live from Hugging Face, resolved through <code>latest.json</code>
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
