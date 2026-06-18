"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, humanizeName, releaseLabel } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  usePopulace,
  usePopulaceReleases,
  type PopulaceTargetRow,
} from "@/lib/api/hooks/use-populace";

function targetError(row: PopulaceTargetRow, phase: "initial" | "final") {
  const value = phase === "initial" ? row.initial_error : row.final_error;
  if (row.error_kind === "absolute") return fmtCompact(value);
  return fmt(value, { pct: true, digits: 1 });
}

function formatPublishedAt(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function targetLabel(row: PopulaceTargetRow): string {
  return [
    row.geography,
    row.variable ? humanizeName(row.variable) : null,
    row.breakdown,
  ]
    .filter(Boolean)
    .join(" · ") || String(row.name ?? "");
}

function fmtLoss(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return value.toExponential(3).replace("e+", "e");
}

function lossReduction(initial: number | null | undefined, value: number | null | undefined) {
  if (
    initial == null ||
    value == null ||
    !Number.isFinite(initial) ||
    !Number.isFinite(value) ||
    initial === 0
  ) {
    return null;
  }
  return (initial - value) / Math.abs(initial);
}

function LossMetric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
        ? "text-rose-700"
        : "text-foreground";

  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1 font-mono text-xl font-semibold leading-none ${toneClass}`}>
        {value}
      </dd>
      {hint && (
        <div className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function LossDevelopmentChart({
  trajectory,
  initialLoss,
  finalLoss,
}: {
  trajectory: number[];
  initialLoss: number | null | undefined;
  finalLoss: number | null | undefined;
}) {
  const values =
    trajectory.length >= 2
      ? trajectory.filter((value) => Number.isFinite(value))
      : [initialLoss, finalLoss].filter(
          (value): value is number => value != null && Number.isFinite(value),
        );

  if (values.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        Loss trajectory unavailable.
      </div>
    );
  }

  const baseline = values[0];
  const reductions = values.map((value) => lossReduction(baseline, value) ?? 0);
  const finalReduction = reductions[reductions.length - 1] ?? null;
  const finalReductionTone =
    finalReduction == null || Math.abs(finalReduction) < 1e-12
      ? "text-muted-foreground"
      : finalReduction > 0
        ? "text-emerald-700"
        : "text-rose-700";
  const min = Math.min(0, ...reductions);
  const max = Math.max(0, ...reductions);
  const span = max - min || 1;
  const width = 620;
  const height = 210;
  const pad = { top: 18, right: 22, bottom: 34, left: 58 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const yFor = (value: number) =>
    pad.top + chartHeight - ((value - min) / span) * chartHeight;
  const points = reductions
    .map((value, index) => {
      const x = pad.left + (index / (reductions.length - 1)) * chartWidth;
      const y = yFor(value);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = yFor(0);
  const firstPoint = {
    x: pad.left,
    y: yFor(reductions[0] ?? 0),
  };
  const lastPoint = {
    x: pad.left + chartWidth,
    y: yFor(reductions[reductions.length - 1] ?? 0),
  };
  const topLabel = fmt(max, { pct: true, digits: 3 });
  const bottomLabel = fmt(min, { pct: true, digits: 3 });

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">
            Percent reduction from initial loss
          </div>
          <div className="text-xs text-muted-foreground">
            0% is the starting objective; higher means the optimizer lowered loss.
          </div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-lg font-semibold ${finalReductionTone}`}>
            {finalReduction == null ? "—" : fmt(finalReduction, { pct: true, digits: 3 })}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            final percent reduction
          </div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Percent reduction from initial loss over optimizer steps"
        className="h-56 w-full overflow-visible rounded-md border border-border bg-white"
      >
        <line
          x1={pad.left}
          x2={pad.left + chartWidth}
          y1={pad.top}
          y2={pad.top}
          className="stroke-border"
          strokeDasharray="3 4"
        />
        <line
          x1={pad.left}
          x2={pad.left + chartWidth}
          y1={zeroY}
          y2={zeroY}
          className="stroke-border"
        />
        <line
          x1={pad.left}
          x2={pad.left}
          y1={pad.top}
          y2={pad.top + chartHeight}
          className="stroke-border"
        />
        <line
          x1={pad.left}
          x2={pad.left + chartWidth}
          y1={pad.top + chartHeight}
          y2={pad.top + chartHeight}
          className="stroke-border"
        />
        <text x="12" y={pad.top + 4} className="fill-muted-foreground text-[12px]">
          {topLabel}
        </text>
        <text x="12" y={pad.top + chartHeight} className="fill-muted-foreground text-[12px]">
          {bottomLabel}
        </text>
        <text
          x={pad.left}
          y={height - 10}
          className="fill-muted-foreground text-[12px]"
        >
          step 0
        </text>
        <text
          x={pad.left + chartWidth}
          y={height - 10}
          textAnchor="end"
          className="fill-muted-foreground text-[12px]"
        >
          step {reductions.length - 1}
        </text>
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-primary"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={firstPoint.x}
          cy={firstPoint.y}
          r="4"
          className="fill-white stroke-primary"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="4"
          className="fill-primary stroke-primary"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function TargetFitTable({
  rows,
  emptyLabel,
}: {
  rows: PopulaceTargetRow[];
  emptyLabel: string;
}) {
  if (!rows.length) return <EmptyState title={emptyLabel} variant="compact" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Target</th>
            <th className="px-3 py-2 font-semibold">Source</th>
            <th className="px-3 py-2 text-right font-semibold">Initial error</th>
            <th className="px-3 py-2 text-right font-semibold">Final error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-border/60 last:border-b-0">
              <td className="max-w-md truncate px-3 py-1.5" title={String(row.name ?? "")}>
                {targetLabel(row)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {row.source}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                {targetError(row, "initial")}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {targetError(row, "final")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PopulaceOverviewView() {
  const [release, setRelease] = useState("");
  const { data: releaseData } = usePopulaceReleases();
  const { data, isLoading, error } = usePopulace(release || undefined);

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
  const within10Count = (cal.family_fit ?? []).reduce(
    (sum, row) => sum + row.within_10pct,
    0,
  );
  const totalTargets = cal.total_targets ?? 0;
  const includedTargets = cal.included_target_count ?? totalTargets;
  const declaredTargets = cal.declared_targets ?? totalTargets;
  const compiledTargets = cal.compiled_candidate_targets ?? includedTargets;
  const skippedTargets = cal.skipped?.length ?? 0;
  const droppedTargets = cal.dropped_target_count ?? Math.max(declaredTargets - compiledTargets, 0);
  const lossDelta =
    cal.initial_loss != null && cal.final_loss != null
      ? cal.final_loss - cal.initial_loss
      : null;
  const lossChange =
    cal.initial_loss != null &&
    cal.initial_loss !== 0 &&
    lossDelta != null
      ? lossDelta / Math.abs(cal.initial_loss)
      : null;
  const lossReductionValue =
    lossChange == null ? null : -lossChange;
  const lossImproved = lossDelta != null && lossDelta < 0;
  const lossChangeMagnitude =
    lossChange == null ? null : Math.abs(lossChange);
  const lossChangeLabel = lossImproved
    ? "Relative loss reduction"
    : lossDelta != null && lossDelta > 0
      ? "Relative loss increase"
      : "Relative loss change";
  const lossCalloutClass = lossImproved
    ? "bg-emerald-50 text-emerald-800"
    : lossDelta != null && lossDelta > 0
      ? "bg-rose-50 text-rose-800"
      : "bg-muted/40 text-muted-foreground";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Release summary"
        description={
          <>
            Calibration diagnostics for the latest published populace-US build from{" "}
            <a
              className="underline decoration-dotted underline-offset-2"
              href={`https://huggingface.co/datasets/${data.source_repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {data.source_repo}
            </a>
            — how well the calibrated weights reproduce populace&apos;s own target
            surface.
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={
            <HelpHint
              label="Targets included"
              tooltip="Targets that made it into the active calibration matrix for this release. Ledger facts can be excluded before this stage if they are unsupported or validation-only."
            />
          }
          value={fmt(includedTargets, { digits: 0 })}
          hint={`${fmt(declaredTargets, { digits: 0 })} declared · ${fmt(droppedTargets, { digits: 0 })} dropped · ${fmt(skippedTargets, { digits: 0 })} skipped`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Within 10% of target"
              tooltip="Share of calibration targets whose final aggregate is within 10% of the target value."
            />
          }
          value={fmt(cal.fraction_within_10pct, { pct: true, digits: 1 })}
          hint={`${fmt(within10Count, { digits: 0 })} of ${fmt(totalTargets, { digits: 0 })} targets`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Records kept"
              tooltip="Records with a non-zero calibrated weight in this release."
            />
          }
          value={cal.n_nonzero == null ? "—" : fmtCompact(cal.n_nonzero)}
          hint={`${fmtCompact(cal.n_records)} source records`}
        />
        <KpiCard
          label="Published"
          value={formatPublishedAt(data.updated_at)}
          hint={release ? releaseLabel(data.release_id) : "Latest release"}
        />
      </div>

      <SectionCard
        title="Total loss development"
        description="Raw optimizer objective reported by the release artifact. Lower is better; this is for within-release convergence, not target-level percent error."
      >
        <div className="grid gap-6 lg:grid-cols-[310px_minmax(0,1fr)]">
          <div>
            <dl className="rounded-md border border-border bg-muted/10 px-4">
              <LossMetric
                label="Initial total loss"
                value={fmtLoss(cal.initial_loss)}
                hint={fmt(cal.initial_loss, { digits: 0 })}
              />
              <LossMetric
                label="Final total loss"
                value={fmtLoss(cal.final_loss)}
                hint={fmt(cal.final_loss, { digits: 0 })}
              />
              <LossMetric
                label={lossChangeLabel}
                value={
                  lossChangeMagnitude == null
                    ? "—"
                    : fmt(lossChangeMagnitude, { pct: true, digits: 3 })
                }
                hint={
                  lossDelta == null
                    ? undefined
                    : `Absolute objective change: ${fmtLoss(Math.abs(lossDelta))}`
                }
                tone={
                  lossImproved
                    ? "positive"
                    : lossDelta != null && lossDelta > 0
                      ? "negative"
                      : "neutral"
                }
              />
            </dl>
            <div className={`mt-3 rounded-md px-3 py-2 text-xs leading-snug ${lossCalloutClass}`}>
              {lossImproved
                ? `Final loss is lower than initial loss by ${lossReductionValue == null ? "—" : fmt(lossReductionValue, { pct: true, digits: 3 })}.`
                : lossDelta == null
                  ? "Loss values were not recorded for this release."
                  : "Final loss did not improve from the initial optimizer objective."}
            </div>
          </div>
          <div className="min-w-0">
            <LossDevelopmentChart
              trajectory={cal.loss_trajectory ?? []}
              initialLoss={cal.initial_loss}
              finalLoss={cal.final_loss}
            />
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Largest target errors"
          description="Percentage error for non-zero targets; absolute miss for zero-valued targets."
          padded={false}
        >
          <TargetFitTable
            rows={data.highlights?.worst_fit ?? []}
            emptyLabel="No targets recorded."
          />
        </SectionCard>
        <SectionCard
          title="Biggest calibration improvements"
          description="Largest reduction in error from the initial weights."
          padded={false}
        >
          <TargetFitTable
            rows={data.highlights?.biggest_improvements ?? []}
            emptyLabel="No targets recorded."
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Release artifacts"
        description={
          <>
            Read live from Hugging Face, resolved through <code>latest.json</code>
            {data.updated_at ? ` (published ${data.updated_at})` : ""}.
          </>
        }
      >
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
