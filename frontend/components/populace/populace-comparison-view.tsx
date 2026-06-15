"use client";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact } from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import {
  usePopulaceComparison,
  type PopulaceComparisonFamilyRow,
  type PopulaceComparisonMover,
} from "@/lib/api/hooks/use-populace";

function loss(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { digits: 4 });
}

function MoversTable({
  rows,
  emptyLabel,
}: {
  rows: PopulaceComparisonMover[];
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
            <th className="px-3 py-2 text-right font-semibold">Populace err</th>
            <th className="px-3 py-2 text-right font-semibold">eCPS err</th>
            <th className="px-3 py-2 text-right font-semibold">Loss delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.target_name}-${index}`}
              className="border-b border-border/60 last:border-b-0"
            >
              <td className="max-w-md truncate px-3 py-1.5" title={String(row.target_name ?? "")}>
                {row.target_name}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {row.family}
              </td>
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

export function PopulaceComparisonView() {
  const { data, isLoading, error } = usePopulaceComparison();

  if (isLoading) return <LoadingBlock label="Loading incumbent comparison…" />;
  if (error || !data) {
    return (
      <EmptyState
        title="Incumbent comparison unavailable"
        description={error instanceof Error ? error.message : "Unknown error."}
      />
    );
  }

  const s = data.summary;
  const families: PopulaceComparisonFamilyRow[] = [...(data.family_breakdown ?? [])].sort(
    (a, b) =>
      (b.candidate_loss_contribution ?? 0) - (a.candidate_loss_contribution ?? 0),
  );
  const totalWins =
    (s.candidate_wins ?? 0) + (s.baseline_wins ?? 0) + (s.ties ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace · Incumbent comparison"
        title="Populace vs enhanced CPS"
        description={
          data.protocol ??
          "Populace (candidate) scored against the enhanced CPS (incumbent) on the frozen target surface."
        }
        status={
          <StatusPill tone={data.archived ? "warning" : "success"}>
            {data.archived ? "Archived scorecard" : "Live from benchmarks"}
          </StatusPill>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={
            <HelpHint
              label="Full loss"
              tooltip="Relative-error loss over all targets after the symmetric refit on matched households. Lower is better."
            />
          }
          value={loss(s.candidate_loss)}
          delta={
            s.candidate_beats_baseline == null
              ? undefined
              : s.candidate_beats_baseline
                ? "beats eCPS"
                : "behind eCPS"
          }
          tone={s.candidate_beats_baseline ? "positive" : "negative"}
          hint={`Enhanced CPS: ${loss(s.baseline_loss)}`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Holdout loss"
              tooltip="Loss on the held-out target fold neither dataset's refit saw — the honest generalization signal."
            />
          }
          value={loss(s.candidate_holdout_loss)}
          hint={`Enhanced CPS: ${loss(s.baseline_holdout_loss)}`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Unweighted MSRE"
              tooltip="Mean squared relative error, unweighted across targets — a promotion metric in the benchmark manifest."
            />
          }
          value={loss(s.candidate_unweighted_msre)}
          hint={`Enhanced CPS: ${loss(s.baseline_unweighted_msre)}`}
        />
        <KpiCard
          label={
            <HelpHint
              label="Per-target wins"
              tooltip="Targets where each dataset has the smaller loss term. Populace concentrates its loss reduction in fewer, larger targets."
            />
          }
          value={`${fmtCompact(s.candidate_wins)} / ${fmtCompact(totalWins || null)}`}
          hint={`eCPS wins ${fmtCompact(s.baseline_wins)}, ties ${fmtCompact(s.ties)}`}
        />
      </div>

      <SectionCard
        title="Loss head-to-head"
        description={`Scored on ${fmtCompact(s.matched_household_count)} matched households across ${fmt(
          s.n_targets,
          { digits: 0 },
        )} targets (${fmt(s.holdout_targets, { digits: 0 })} held out).`}
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
                  ["Train", s.candidate_train_loss, s.baseline_train_loss],
                  ["Holdout", s.candidate_holdout_loss, s.baseline_holdout_loss],
                  ["Full", s.candidate_loss, s.baseline_loss],
                  [
                    "Unweighted MSRE",
                    s.candidate_unweighted_msre,
                    s.baseline_unweighted_msre,
                  ],
                ] as const
              ).map(([label, candidate, baseline]) => (
                <tr key={label} className="border-b border-border/60 last:border-b-0">
                  <td className="px-3 py-1.5">{label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{loss(candidate)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{loss(baseline)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {candidate != null && baseline != null && candidate > 0
                      ? `${(baseline / candidate).toFixed(1)}× better`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

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
                <th className="px-3 py-2 text-right font-semibold">Populace loss</th>
                <th className="px-3 py-2 text-right font-semibold">eCPS loss</th>
                <th className="px-3 py-2 text-right font-semibold">Delta</th>
              </tr>
            </thead>
            <tbody>
              {families.map((row) => (
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

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Top regressions vs enhanced CPS"
          description="Targets where populace's loss term most exceeds the enhanced CPS's."
          padded={false}
        >
          <MoversTable
            rows={data.top_regressions ?? []}
            emptyLabel="No regressions recorded."
          />
        </SectionCard>
        <SectionCard
          title="Top improvements vs enhanced CPS"
          description="Targets where populace most reduces the loss term relative to the enhanced CPS."
          padded={false}
        >
          <MoversTable
            rows={data.top_improvements ?? []}
            emptyLabel="No improvements recorded."
          />
        </SectionCard>
      </div>

      <SectionCard
        title="About this comparison"
        description={
          <>
            Candidate <code>{data.release_id}</code> vs incumbent{" "}
            <code>{data.incumbent_manifest}</code>
            {data.period ? ` (period ${data.period})` : ""}.
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
