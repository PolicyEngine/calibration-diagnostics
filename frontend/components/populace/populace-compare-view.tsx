"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, fmtSigned, humanizeName, releaseLabel } from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  usePopulaceCompare,
  usePopulaceReleases,
  type PopulaceComparisonRow,
} from "@/lib/api/hooks/use-populace";

const MAX_MOVER_REL_ERROR = 10; // Keep the compare summary to bounded relative errors (<= 1000%).

function relErr(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { pct: true, digits: 1 });
}

function fmtLoss(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  return value.toExponential(3).replace("e+", "e");
}

function relativeChange(
  from: number | null | undefined,
  to: number | null | undefined,
): number | null {
  if (
    from == null ||
    to == null ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from === 0
  ) {
    return null;
  }
  return (to - from) / Math.abs(from);
}

function errorValue(row: PopulaceComparisonRow, side: "a" | "b") {
  const value = side === "a" ? row.a_error : row.b_error;
  if (row.error_kind === "absolute") return fmtCompact(value);
  return relErr(value);
}

function targetLabel(row: PopulaceComparisonRow) {
  return row.target_label || row.breakdown || row.geography || row.name;
}

function isBoundedRelativeMover(row: PopulaceComparisonRow) {
  return (
    row.error_kind === "relative" &&
    row.abs_rel_delta != null &&
    row.a_error != null &&
    row.b_error != null &&
    Math.abs(row.a_error) <= MAX_MOVER_REL_ERROR &&
    Math.abs(row.b_error) <= MAX_MOVER_REL_ERROR
  );
}

function MoversTable({ rows }: { rows: PopulaceComparisonRow[] }) {
  if (!rows.length) return <EmptyState title="No common targets to compare." variant="compact" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Target</th>
            <th className="px-3 py-2 font-semibold">Variable</th>
            <th className="px-3 py-2 text-right font-semibold">A err</th>
            <th className="px-3 py-2 text-right font-semibold">B err</th>
            <th className="px-3 py-2 text-right font-semibold">|err| change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-border/60 last:border-b-0">
              <td className="max-w-md truncate px-3 py-1.5" title={row.name}>
                {targetLabel(row)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                {row.variable ? humanizeName(row.variable as string) : row.variable_key}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {errorValue(row, "a")}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {errorValue(row, "b")}
              </td>
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${
                  (row.abs_rel_delta ?? 0) < 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {row.abs_rel_delta == null ? "—" : fmtSigned(row.abs_rel_delta, { pct: true, digits: 1 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LossRow({
  label,
  initial,
  final,
}: {
  label: string;
  initial: number | null | undefined;
  final: number | null | undefined;
}) {
  const reduction = relativeChange(initial, final);
  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <td className="px-3 py-2 font-medium">{label}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtLoss(initial)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtLoss(final)}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {reduction == null ? "—" : fmt(-reduction, { pct: true, digits: 3 })}
      </td>
    </tr>
  );
}

export function PopulaceCompareView() {
  const { data: releaseData, isLoading: releasesLoading } = usePopulaceReleases();
  const releases = releaseData?.releases ?? [];

  const [a, setA] = useState("");
  const [b, setB] = useState("");

  // Default B to the latest release and A to the next one down.
  useEffect(() => {
    if (!releases.length) return;
    if (!b) setB(releaseData?.latest_release_id || releases[0].release_id);
    if (!a && releases[1]) setA(releases[1].release_id);
  }, [releases, releaseData, a, b]);

  const { data, isLoading, error } = usePopulaceCompare(a, b);

  const options = useMemo(
    () => releases.map((r) => ({ value: r.release_id, label: releaseLabel(r.release_id, r.date) })),
    [releases],
  );
  const dateOf = (id: string) => {
    const r = releases.find((x) => x.release_id === id);
    return r ? releaseLabel(r.release_id, r.date) : id;
  };

  const improvements = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => isBoundedRelativeMover(r) && (r.abs_rel_delta ?? 0) < 0)
        .slice(0, 20),
    [data],
  );
  const regressions = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => isBoundedRelativeMover(r) && (r.abs_rel_delta ?? 0) > 0)
        .slice(0, 20),
    [data],
  );
  const lossDelta =
    data?.a.final_loss != null && data.b.final_loss != null
      ? data.b.final_loss - data.a.final_loss
      : null;
  const lossChange = data ? relativeChange(data.a.final_loss, data.b.final_loss) : null;
  const bLossLower = lossDelta != null && lossDelta < 0;
  const bLossHigher = lossDelta != null && lossDelta > 0;
  const lossTone = bLossLower ? "positive" : bLossHigher ? "negative" : "neutral";
  const lossHeadline =
    lossChange == null
      ? "—"
      : fmt(Math.abs(lossChange), { pct: true, digits: 3 });
  const lossHeadlineLabel = data?.summary.losses_comparable
    ? bLossLower
      ? "B better by final loss"
      : bLossHigher
        ? "B worse by final loss"
        : "Final loss unchanged"
    : bLossLower
      ? "B lower raw loss"
      : bLossHigher
        ? "B higher raw loss"
        : "Raw loss unchanged";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Compare versions"
        description="Diff two published populace-US releases. Targets are matched by name; common targets get a fit change (negative = release B fits it better), and targets present in only one release are counted as added/removed."
      />

      <SectionCard title="Releases">
        {releasesLoading ? (
          <LoadingBlock label="Loading releases…" height="h-20" />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <ToolbarSelect
              label="Release A"
              value={a}
              onChange={setA}
              options={options}
            />
            <span className="text-muted-foreground">→</span>
            <ToolbarSelect label="B (compare)" value={b} onChange={setB} options={options} />
          </div>
        )}
      </SectionCard>

      {isLoading ? (
        <LoadingBlock label="Comparing releases…" />
      ) : error || !data ? (
        <EmptyState
          title="Comparison unavailable"
          description={error instanceof Error ? error.message : "Pick two releases above."}
        />
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            A <span className="font-medium text-foreground">{dateOf(a)}</span>
            {"  →  "}
            B <span className="font-medium text-foreground">{dateOf(b)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Targets A → B"
              value={`${fmt(data.a.total_targets, { digits: 0 })} → ${fmt(data.b.total_targets, { digits: 0 })}`}
              hint={`${fmt(data.summary.common, { digits: 0 })} in common`}
            />
            <KpiCard
              label="Added / removed"
              value={`+${fmt(data.summary.added, { digits: 0 })} / −${fmt(data.summary.removed, { digits: 0 })}`}
              hint="targets only in B / only in A"
            />
            <KpiCard
              label="Improved"
              value={fmt(data.summary.improved, { digits: 0 })}
              tone="positive"
              hint={`${fmt(data.summary.regressed, { digits: 0 })} regressed, ${fmt(data.summary.unchanged, { digits: 0 })} unchanged`}
            />
            <KpiCard
              label="Within 10% A → B"
              value={`${fmt(data.a.fraction_within_10pct, { pct: true, digits: 0 })} → ${fmt(data.b.fraction_within_10pct, { pct: true, digits: 0 })}`}
              hint={`${fmt(data.summary.common, { digits: 0 })} common targets`}
            />
          </div>

          <SectionCard
            title="Version-over-version loss"
            description={
              data.summary.losses_comparable
                ? "Final optimizer loss for B compared with A. Lower is better when target surfaces match."
                : "Raw optimizer loss for B compared with A. These releases have different target surfaces, so treat this as directional context rather than a clean apples-to-apples fit score."
            }
          >
            <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
              <KpiCard
                label={lossHeadlineLabel}
                value={lossHeadline}
                tone={lossTone}
                hint={
                  lossDelta == null
                    ? "final loss unavailable"
                    : `${fmtLoss(data.a.final_loss)} → ${fmtLoss(data.b.final_loss)}`
                }
                size="lg"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Release</th>
                      <th className="px-3 py-2 text-right font-semibold">Initial loss</th>
                      <th className="px-3 py-2 text-right font-semibold">Final loss</th>
                      <th className="px-3 py-2 text-right font-semibold">Within-run reduction</th>
                    </tr>
                  </thead>
                  <tbody>
                    <LossRow label="A" initial={data.a.initial_loss} final={data.a.final_loss} />
                    <LossRow label="B" initial={data.b.initial_loss} final={data.b.final_loss} />
                    <tr className="border-t border-border bg-muted/20">
                      <td className="px-3 py-2 font-medium">B vs A final</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                      <td
                        className={`px-3 py-2 text-right font-mono tabular-nums ${
                          bLossLower ? "text-emerald-700" : bLossHigher ? "text-rose-700" : ""
                        }`}
                      >
                        {lossDelta == null ? "—" : fmtLoss(Math.abs(lossDelta))}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          bLossLower ? "text-emerald-700" : bLossHigher ? "text-rose-700" : ""
                        }`}
                      >
                        {lossChange == null
                          ? "—"
                          : fmtSigned(lossChange, { pct: true, digits: 3 })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard
              title="Most improved (B vs A)"
              description="Common non-zero targets whose absolute relative error fell the most from A to B, excluding tiny-denominator extremes above 1000%."
              padded={false}
            >
              <MoversTable rows={improvements} />
            </SectionCard>
            <SectionCard
              title="Most regressed (B vs A)"
              description="Common non-zero targets whose absolute relative error rose the most from A to B, excluding tiny-denominator extremes above 1000%."
              padded={false}
            >
              <MoversTable rows={regressions} />
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}
