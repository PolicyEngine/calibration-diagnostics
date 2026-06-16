"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

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
  usePopulace,
  usePopulaceReleases,
  type PopulaceFamilyFitRow,
  type PopulaceTargetRow,
} from "@/lib/api/hooks/use-populace";

const SMOKE_LABELS: Record<string, string> = {
  people_m: "People (millions)",
  snap_b: "SNAP ($B)",
  net_worth_t: "Net worth ($T)",
  net_stcg_b: "Net short-term capital gains ($B)",
  tips_b: "Tip income ($B)",
  pre_subsidy_rent_b: "Pre-subsidy rent ($B)",
  investment_interest_expense_b: "Investment interest expense ($B)",
};

const OPTION_LABELS: { key: string; label: string }[] = [
  { key: "epochs", label: "Epochs" },
  { key: "learning_rate", label: "Learning rate" },
  { key: "mass", label: "Mass" },
  { key: "max_weight_ratio", label: "Max weight ratio" },
  { key: "seed", label: "Seed" },
];

function relErr(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { pct: true, digits: 1 });
}

function LossSparkline({ trajectory }: { trajectory: number[] }) {
  if (trajectory.length < 2) {
    return <span className="text-xs text-muted-foreground">trace unavailable</span>;
  }
  const width = 220;
  const height = 44;
  const max = Math.max(...trajectory);
  const min = Math.min(...trajectory);
  const span = max - min || 1;
  const points = trajectory
    .map((value, index) => {
      const x = (index / (trajectory.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-primary"
      />
    </svg>
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
            <th className="px-3 py-2 font-semibold">Family</th>
            <th className="px-3 py-2 text-right font-semibold">Initial err</th>
            <th className="px-3 py-2 text-right font-semibold">Final err</th>
            <th className="px-3 py-2 text-center font-semibold">In tol.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-border/60 last:border-b-0">
              <td className="max-w-md truncate px-3 py-1.5" title={String(row.name ?? "")}>
                {row.name}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {row.family}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                {relErr(row.initial_relative_error)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {relErr(row.relative_error)}
              </td>
              <td className="px-3 py-1.5 text-center">
                {row.within_tolerance == null
                  ? "—"
                  : row.within_tolerance
                    ? "✓"
                    : "✗"}
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
        label: r.release_id.replace(/^populace-us-\d{4}-/, "").replace(/-c[0-9a-f]{12}-/, "·"),
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

  const gates = data.gates ?? {};
  const calibrationGate = gates.calibration ?? {};
  const cal = data.calibration ?? { available: false };
  const options = cal.options ?? {};
  const lossDelta =
    cal.initial_loss != null && cal.final_loss != null
      ? cal.final_loss - cal.initial_loss
      : null;
  const recordsKept =
    cal.n_nonzero != null && cal.n_records != null && cal.n_records > 0
      ? cal.n_nonzero / cal.n_records
      : null;
  const withinTolShare =
    cal.within_tolerance_count != null && cal.total_targets
      ? cal.within_tolerance_count / cal.total_targets
      : null;
  const familyFit: PopulaceFamilyFitRow[] = cal.family_fit ?? [];
  const diagnosticsNote =
    typeof options.diagnostics_source === "string" ? options.diagnostics_source : null;

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
          <ToolbarSelect label="Release" value={release} onChange={setRelease} options={releaseOptions} />
        }
        status={
          <StatusPill tone="success">
            {data.release_id} · {fmt(data.calibration.total_targets ?? null, { digits: 0 })} targets
          </StatusPill>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={
            <HelpHint
              label="Calibration loss"
              tooltip="The eCPS relative-error loss mean(((est − target)/(target + 1))²) over all targets under the calibrated weights. Lower is better."
            />
          }
          value={cal.final_loss == null ? "—" : fmt(cal.final_loss, { digits: 4 })}
          delta={lossDelta == null ? undefined : fmt(lossDelta, { digits: 3 })}
          tone={lossDelta != null && lossDelta < 0 ? "positive" : "neutral"}
          hint={`From initial ${fmt(cal.initial_loss, { digits: 3 })}`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Within 10% of target"
              tooltip="Share of targets whose calibrated aggregate lands within 10% of the declared value."
            />
          }
          value={fmt(cal.fraction_within_10pct, { pct: true, digits: 1 })}
          hint={
            withinTolShare == null
              ? undefined
              : `${fmt(withinTolShare, { pct: true, digits: 1 })} within declared tolerance`
          }
        />
        <KpiCard
          label={
            <HelpHint
              label="Records kept"
              tooltip="Households with a non-zero calibrated weight after L0 pruning, out of the full pool."
            />
          }
          value={cal.n_nonzero == null ? "—" : fmtCompact(cal.n_nonzero)}
          hint={
            recordsKept == null
              ? `of ${fmtCompact(cal.n_records)}`
              : `${fmt(recordsKept, { pct: true, digits: 1 })} of ${fmtCompact(cal.n_records)}`
          }
        />
        <KpiCard
          label={
            <HelpHint
              label="Targets"
              tooltip="Total calibration targets in this release's surface, and how many were skipped (failed to compile)."
            />
          }
          value={fmtCompact(cal.total_targets ?? null)}
          hint={`${(cal.skipped ?? []).length} skipped`}
        />
      </div>

      <SectionCard
        title="Acceptance gates"
        description={
          <>
            Gate verdicts recorded in <code>build_manifest.json</code> for build{" "}
            <code>{data.release_id}</code>.{" "}
            {String(data.build_manifest?.construction ?? "")}
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={(gates.parity_gaps ?? 1) === 0 ? "success" : "danger"}>
                Parity gaps: {fmt(gates.parity_gaps, { digits: 0 })}
              </StatusPill>
              <StatusPill tone={gates.exported_nonzero?.passed ? "success" : "danger"}>
                Exported non-zero ({fmt(gates.exported_nonzero?.stored_columns, { digits: 0 })}{" "}
                columns)
              </StatusPill>
              <StatusPill
                tone={(calibrationGate.weights_above_500k ?? 1) === 0 ? "success" : "warning"}
              >
                Weights above 500k: {fmt(calibrationGate.weights_above_500k, { digits: 0 })}
              </StatusPill>
            </div>
            <div className="text-xs text-muted-foreground">
              Max calibrated weight {fmtCompact(calibrationGate.max_weight)} under a hard{" "}
              {fmt(calibrationGate.max_weight_ratio, { digits: 0 })}× per-record bound.
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(gates.smoke ?? {}).map(([key, value]) => (
                <tr key={key} className="border-b border-border/60 last:border-b-0">
                  <td className="py-1 pr-3 text-muted-foreground">
                    {SMOKE_LABELS[key] ?? key}
                  </td>
                  <td className="py-1 text-right tabular-nums">{fmt(value, { digits: 1 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Convergence"
          description="Calibration loss across the optimization."
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Initial → final loss
                </div>
                <div className="text-lg font-semibold tabular-nums">
                  {fmt(cal.initial_loss, { digits: 3 })} →{" "}
                  {fmt(cal.final_loss, { digits: 4 })}
                </div>
              </div>
              <LossSparkline trajectory={cal.loss_trajectory ?? []} />
            </div>
            {diagnosticsNote && (
              <p className="text-xs leading-snug text-muted-foreground">{diagnosticsNote}</p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Solver configuration"
          description="The options this calibration ran under (release provenance)."
        >
          <table className="w-full text-sm">
            <tbody>
              {OPTION_LABELS.map(({ key, label }) =>
                options[key] == null ? null : (
                  <tr key={key} className="border-b border-border/60 last:border-b-0">
                    <td className="py-1 pr-3 text-muted-foreground">{label}</td>
                    <td className="py-1 text-right tabular-nums">{String(options[key])}</td>
                  </tr>
                ),
              )}
              <tr className="border-b border-border/60 last:border-b-0">
                <td className="py-1 pr-3 text-muted-foreground">L0 penalty</td>
                <td className="py-1 text-right tabular-nums">
                  {cal.l0_lambda == null ? "—" : cal.l0_lambda.toExponential(2)}
                </td>
              </tr>
              <tr className="border-b border-border/60 last:border-b-0">
                <td className="py-1 pr-3 text-muted-foreground">Weight entity</td>
                <td className="py-1 text-right">{cal.weight_entity ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </SectionCard>
      </div>

      <SectionCard
        title="Calibration fit by target family"
        description="How well each source family is reproduced under the calibrated weights, from the per-target rows."
        actions={
          <Link
            href="/populace/targets"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60"
          >
            Explore all targets →
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Family</th>
                <th className="px-3 py-2 text-right font-semibold">Targets</th>
                <th className="px-3 py-2 text-right font-semibold">Within 10%</th>
                <th className="px-3 py-2 text-right font-semibold">Within tolerance</th>
                <th className="px-3 py-2 text-right font-semibold">Mean abs rel. error</th>
              </tr>
            </thead>
            <tbody>
              {familyFit.map((row) => (
                <tr key={row.family} className="border-b border-border/60 last:border-b-0">
                  <td className="px-3 py-1.5">{row.family}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(row.n_targets, { digits: 0 })}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(row.within_10pct, { digits: 0 })} (
                    {fmt(row.within_10pct / row.n_targets, { pct: true, digits: 0 })})
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmt(row.within_tolerance, { digits: 0 })}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {relErr(row.mean_abs_relative_error)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Worst-fit targets"
          description="Largest absolute relative error under the calibrated weights."
          padded={false}
        >
          <TargetFitTable
            rows={data.highlights?.worst_fit ?? []}
            emptyLabel="No targets recorded."
          />
        </SectionCard>
        <SectionCard
          title="Biggest calibration improvements"
          description="Targets where calibration most reduced the relative error from the design weights."
          padded={false}
        >
          <TargetFitTable
            rows={data.highlights?.biggest_improvements ?? []}
            emptyLabel="No targets recorded."
          />
        </SectionCard>
      </div>

      {(cal.skipped ?? []).length > 0 && (
        <SectionCard
          title={`Skipped targets (${(cal.skipped ?? []).length})`}
          description="Targets that could not be compiled against the frame, with the reason."
          padded={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Target</th>
                  <th className="px-3 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(cal.skipped ?? []).map((skip) => (
                  <tr key={skip.name} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-1.5">{skip.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{skip.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

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
