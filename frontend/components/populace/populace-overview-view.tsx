"use client";

import { useMemo, useState } from "react";

import { CalibrationMap } from "@/components/populace/calibration-map";
import { useCountry } from "@/components/layout/country-context";
import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  releaseSelectOptions,
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

// Compact loss-trajectory chart: epochs on x, log10(loss) on y.
function LossCurve({ trajectory }: { trajectory: number[] }) {
  const points = trajectory.filter((v) => Number.isFinite(v) && v > 0);
  if (points.length < 2) return null;
  const w = 420;
  const h = 96;
  const logs = points.map((v) => Math.log10(v));
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const span = max - min || 1;
  const path = logs
    .map((v, i) => {
      const x = (i / (points.length - 1)) * (w - 8) + 4;
      const y = h - 14 - ((v - min) / span) * (h - 24);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md" role="img" aria-label="calibration loss by epoch">
      <path d={path} fill="none" stroke="#319795" strokeWidth="1.8" />
      <text x="4" y={h - 2} fontSize="9" fill="#94A3B8">epoch 1</text>
      <text x={w - 4} y={h - 2} fontSize="9" fill="#94A3B8" textAnchor="end">{points.length}</text>
      <text x="4" y="10" fontSize="9" fill="#94A3B8">log loss</text>
    </svg>
  );
}

export function PopulaceOverviewView() {
  const { country } = useCountry();
  const [release, setRelease] = useState("");
  const [geoLevel, setGeoLevel] = useState("");
  const { data: releaseData } = usePopulaceReleases();
  const { data, isLoading, error } = usePopulace(release || undefined);
  const { data: treemap } = usePopulaceTargetTreemap(
    release || undefined,
    geoLevel || undefined,
  );

  const releaseOptions = useMemo(() => releaseSelectOptions(releaseData), [releaseData]);

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

      <SectionCard
        title="Calibration map"
        actions={
          <ToolbarSelect
            label="Geography"
            value={geoLevel}
            onChange={setGeoLevel}
            options={[
              { value: "", label: "All geographies" },
              { value: "national", label: "National" },
              { value: "state", label: "State" },
              { value: "congressional_district", label: "Congressional district" },
            ]}
          />
        }
      >
        {treemap ? (
          <CalibrationMap
            data={treemap}
            release={release || undefined}
            level={geoLevel || undefined}
          />
        ) : (
          <LoadingBlock label="Building calibration map…" />
        )}
      </SectionCard>

      <details className="group overflow-hidden rounded-lg border border-border/80 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-muted/20 px-5 py-3 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight text-foreground">
              Calibration details
            </div>
            <div className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
              Optimizer recipe, convergence curve, and any targets dropped at compilation.
              {(data.build_manifest as { staging?: { run_id?: string } | null })?.staging
                ?.run_id && (
                <>
                  {" "}
                  <a
                    href="/populace/staging"
                    className="text-primary underline decoration-dotted underline-offset-2"
                  >
                    Built via staging run ↗
                  </a>
                </>
              )}
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-border p-5">
          {cal.options && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-4">
              {[
                ["method", "Method"],
                ["epochs", "Epochs"],
                ["learning_rate", "Learning rate"],
                ["mass", "Mass policy"],
                ["max_weight_ratio", "Max weight ratio"],
                ["l0_lambda", "L0 λ"],
                ["l1_lambda", "L1 λ"],
                ["l2_lambda", "L2 λ"],
                ["seed", "Seed"],
              ].map(([key, label]) => {
                const value = (cal.options as Record<string, unknown>)[key];
                if (value == null || typeof value === "object") return null;
                return (
                  <div key={key} className="flex justify-between gap-2 border-b border-border/40 py-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono text-foreground">{String(value)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {(cal.loss_trajectory ?? []).length >= 2 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Loss trajectory
              </div>
              <LossCurve trajectory={cal.loss_trajectory ?? []} />
            </div>
          )}
          {(() => {
            const tc = (data.gates ?? {}).target_compilation as
              | { declared_targets?: number; compiled_candidate_targets?: number; dropped_target_names?: string[] }
              | undefined;
            const dropped = tc?.dropped_target_names ?? [];
            return (
              <div className="text-xs text-muted-foreground">
                Declared {fmt(tc?.declared_targets ?? null, { digits: 0 })} targets · compiled{" "}
                {fmt(tc?.compiled_candidate_targets ?? null, { digits: 0 })} · dropped {dropped.length}
                {dropped.length > 0 && (
                  <ul className="mt-1 max-h-40 list-inside list-disc overflow-y-auto font-mono text-[11px]">
                    {dropped.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>
      </details>

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
