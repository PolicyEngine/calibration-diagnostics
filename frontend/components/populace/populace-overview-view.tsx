"use client";

import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import {
  usePopulace,
  type PopulaceFamilyBreakdownRow,
  type PopulaceTargetDiagnosticRow,
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

function lossCell(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { digits: 4 });
}

function TargetMoversTable({
  rows,
  emptyLabel,
}: {
  rows: PopulaceTargetDiagnosticRow[];
  emptyLabel: string;
}) {
  if (!rows.length) {
    return <EmptyState title={emptyLabel} variant="compact" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Target</th>
            <th className="px-3 py-2 font-semibold">Family</th>
            <th className="px-3 py-2 font-semibold">Split</th>
            <th className="px-3 py-2 text-right font-semibold">Populace rel. error</th>
            <th className="px-3 py-2 text-right font-semibold">eCPS rel. error</th>
            <th className="px-3 py-2 text-right font-semibold">Loss delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.target_name}-${row.target_index}`}
              className="border-b border-border/60 last:border-b-0"
            >
              <td className="max-w-md truncate px-3 py-1.5" title={String(row.target_name ?? "")}>
                {row.target_name}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {row.family}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">{row.split}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {fmt(row.candidate_relative_error, { pct: true, digits: 1 })}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {fmt(row.baseline_relative_error, { pct: true, digits: 1 })}
              </td>
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${
                  (row.loss_delta ?? 0) < 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {row.loss_delta == null ? "—" : row.loss_delta.toExponential(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PopulaceOverviewView() {
  const { data, isLoading, error } = usePopulace();

  if (isLoading) return <LoadingBlock label="Loading populace release…" />;
  if (error || !data) {
    return (
      <EmptyState
        title="Populace release data unavailable"
        description={error instanceof Error ? error.message : "Unknown error."}
      />
    );
  }

  const score = data.score_vs_enhanced_cps ?? {};
  const gates = data.gates ?? {};
  const calibrationGate = gates.calibration ?? {};
  const wins = score.per_target_wins ?? {};
  const totalWins =
    (wins.populace ?? 0) + (wins.enhanced_cps ?? 0) + (wins.ties ?? 0);
  const comparison = data.comparison ?? { available: false };
  const familyRows: PopulaceFamilyBreakdownRow[] = [
    ...(comparison.family_breakdown ?? []),
  ].sort(
    (a, b) =>
      (b.candidate_loss_contribution ?? 0) - (a.candidate_loss_contribution ?? 0),
  );
  const populaceFullLoss = score.full_loss?.populace ?? null;
  const ecpsFullLoss = score.full_loss?.enhanced_cps ?? null;
  const populaceBeatsEcps =
    populaceFullLoss != null && ecpsFullLoss != null
      ? populaceFullLoss < ecpsFullLoss
      : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Release summary"
        description={
          <>
            Latest published populace-US build from{" "}
            <a
              className="underline decoration-dotted underline-offset-2"
              href={`https://huggingface.co/datasets/${data.source_repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {data.source_repo}
            </a>
            , scored against the enhanced CPS with a matched-household,
            symmetric-refit, held-out-target protocol.
          </>
        }
        status={
          <StatusPill tone={data.source === "huggingface_live" ? "success" : "warning"}>
            {data.source === "huggingface_live"
              ? "Live from Hugging Face"
              : "Static snapshot"}
          </StatusPill>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={
            <HelpHint
              label="Full loss (populace)"
              tooltip="Relative-error loss mean(((est − target)/(target + 1))²) over all 3,704 targets after the symmetric refit. Lower is better."
            />
          }
          value={lossCell(populaceFullLoss)}
          delta={
            populaceBeatsEcps == null
              ? undefined
              : populaceBeatsEcps
                ? "beats eCPS"
                : "behind eCPS"
          }
          tone={populaceBeatsEcps ? "positive" : "negative"}
          hint={`Enhanced CPS: ${lossCell(ecpsFullLoss)}`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Holdout loss"
              tooltip="Loss on the held-out target fold the calibration never saw — the honest generalization signal."
            />
          }
          value={lossCell(score.holdout_loss?.populace)}
          hint={`Enhanced CPS: ${lossCell(score.holdout_loss?.enhanced_cps)}`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Within 10% of target"
              tooltip="Share of calibration targets whose calibrated aggregate lands within 10% of the declared value (calibration gate)."
            />
          }
          value={fmt(calibrationGate.within_10pct_share, { pct: true, digits: 1 })}
          hint={`Calibration loss ${fmt(calibrationGate.loss, { digits: 4 })}, max weight ratio ${fmt(calibrationGate.max_weight_ratio, { digits: 0 })}×`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Per-target wins"
              tooltip="Number of the 3,704 scored targets where each dataset has the smaller loss term. Populace concentrates its loss reduction in fewer, larger targets."
            />
          }
          value={`${fmtCompact(wins.populace)} / ${fmtCompact(totalWins || null)}`}
          hint={`Enhanced CPS wins ${fmtCompact(wins.enhanced_cps)}, ties ${fmtCompact(wins.ties)}`}
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
              <StatusPill
                tone={gates.exported_nonzero?.passed ? "success" : "danger"}
              >
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

      <SectionCard
        title="Score vs enhanced CPS"
        description={score.protocol ?? "Matched-household symmetric-refit comparison."}
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
                <th className="px-3 py-2 font-semibold">Loss</th>
                <th className="px-3 py-2 text-right font-semibold">Populace</th>
                <th className="px-3 py-2 text-right font-semibold">Enhanced CPS</th>
                <th className="px-3 py-2 text-right font-semibold">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Train", score.train_loss],
                  ["Holdout", score.holdout_loss],
                  ["Full", score.full_loss],
                ] as const
              ).map(([label, losses]) => {
                const populace = losses?.populace ?? null;
                const ecps = losses?.enhanced_cps ?? null;
                return (
                  <tr key={label} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-1.5">{label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{lossCell(populace)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{lossCell(ecps)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {populace != null && ecps != null && populace > 0
                        ? `${(ecps / populace).toFixed(1)}× better`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {comparison.available && (
        <SectionCard
          title="Loss by target family"
          description="Per-family loss contribution under the matched symmetric refit. Negative delta means populace fits the family better than the enhanced CPS."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Family</th>
                  <th className="px-3 py-2 text-right font-semibold">Targets</th>
                  <th className="px-3 py-2 text-right font-semibold">Populace wins</th>
                  <th className="px-3 py-2 text-right font-semibold">eCPS wins</th>
                  <th className="px-3 py-2 text-right font-semibold">Populace loss contrib.</th>
                  <th className="px-3 py-2 text-right font-semibold">eCPS loss contrib.</th>
                  <th className="px-3 py-2 text-right font-semibold">Delta</th>
                </tr>
              </thead>
              <tbody>
                {familyRows.map((row) => (
                  <tr key={row.family} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-1.5">{row.family}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmt(row.n_targets, { digits: 0 })}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmt(row.candidate_wins, { digits: 0 })}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {fmt(row.baseline_wins, { digits: 0 })}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {row.candidate_loss_contribution == null
                        ? "—"
                        : row.candidate_loss_contribution.toExponential(2)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {row.baseline_loss_contribution == null
                        ? "—"
                        : row.baseline_loss_contribution.toExponential(2)}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${
                        (row.loss_delta ?? 0) < 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {row.loss_delta == null ? "—" : row.loss_delta.toExponential(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {comparison.available && (
        <div className="grid gap-5 xl:grid-cols-2">
          <SectionCard
            title="Top regressions vs enhanced CPS"
            description="Targets where populace's loss term most exceeds the enhanced CPS's."
            padded={false}
          >
            <TargetMoversTable
              rows={comparison.top_regressions ?? []}
              emptyLabel="No regressions recorded."
            />
          </SectionCard>
          <SectionCard
            title="Top improvements vs enhanced CPS"
            description="Targets where populace most reduces the loss term relative to the enhanced CPS."
            padded={false}
          >
            <TargetMoversTable
              rows={comparison.top_improvements ?? []}
              emptyLabel="No improvements recorded."
            />
          </SectionCard>
        </div>
      )}

      <SectionCard
        title="Release artifacts"
        description={
          <>
            {data.releases.length
              ? `${data.releases.length} release${data.releases.length === 1 ? "" : "s"} published under releases/ in ${data.source_repo}.`
              : "Release listing unavailable; showing the deployed snapshot."}
            {data.comparison_snapshot_stale && (
              <span className="text-amber-700">
                {" "}
                The per-target snapshot below was built from {data.snapshot_release_id},
                which is older than the live release.
              </span>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {data.releases.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.releases.map((release) => (
                <StatusPill
                  key={release.release_id}
                  tone={release.release_id === data.release_id ? "info" : "neutral"}
                >
                  {release.release_id}
                  {release.release_id === data.release_id ? " (active)" : ""}
                </StatusPill>
              ))}
            </div>
          )}
          <table className="w-full text-left text-sm">
            <tbody>
              {data.source_artifacts.map((artifact) => (
                <tr key={artifact.name} className="border-b border-border/60 last:border-b-0">
                  <td className="py-1.5 pr-3 font-medium">{artifact.name}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    {artifact.url.startsWith("http") ? (
                      <a
                        className="underline decoration-dotted underline-offset-2"
                        href={artifact.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {artifact.path}
                      </a>
                    ) : (
                      <>
                        {artifact.path}{" "}
                        <span className="text-xs">(deployed snapshot)</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground">
            Compatible with{" "}
            {(data.release_manifest.compatible_model_packages ?? [])
              .map((pkg) => `${pkg.name}${pkg.specifier}`)
              .join(", ") || "—"}
            .
          </div>
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
