"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtSignedMoney, fmtMoney, releaseLabel } from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  usePopulaceReformHistory,
  usePopulaceReforms,
  usePopulaceReleases,
  type ReformHistorySeries,
  type ReformValidationRow,
} from "@/lib/api/hooks/use-populace";

const POPULACE_REFORMS_ISSUE =
  "https://github.com/PolicyEngine/populace/issues";

function pct(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { pct: true, digits: 1 });
}

function errorTone(absRel: number | null | undefined): "positive" | "neutral" | "negative" {
  if (absRel == null) return "neutral";
  if (absRel <= 0.1) return "positive";
  if (absRel <= 0.25) return "neutral";
  return "negative";
}

// A compact bar series of a reform's |error| across releases (oldest → newest).
function Sparkline({ series }: { series: ReformHistorySeries }) {
  const points = series.points.filter((p) => p.abs_relative_error != null);
  if (points.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const max = Math.max(...points.map((p) => p.abs_relative_error as number), 0.1);
  return (
    <div className="flex h-8 items-end gap-0.5" title="|error| by release (oldest → newest)">
      {points.map((p) => {
        const h = Math.max(2, Math.round(((p.abs_relative_error as number) / max) * 28));
        const good = (p.abs_relative_error as number) <= 0.1;
        return (
          <div
            key={p.release_id}
            className={`w-1.5 rounded-sm ${good ? "bg-emerald-500/70" : "bg-amber-500/70"}`}
            style={{ height: `${h}px` }}
            title={`${releaseLabel(p.release_id, p.date)}: ${pct(p.abs_relative_error)}`}
          />
        );
      })}
    </div>
  );
}

function ReformTable({ rows }: { rows: ReformValidationRow[] }) {
  if (!rows.length) {
    return <EmptyState title="No reforms in this release's validation set." variant="compact" />;
  }
  // Out-of-sample reforms (the genuine test) first, then in-sample targets.
  const ordered = [...rows].sort(
    (a, b) => Number(a.in_sample ?? false) - Number(b.in_sample ?? false),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Reform</th>
            <th className="px-3 py-2 text-right font-semibold">JCT score</th>
            <th className="px-3 py-2 text-right font-semibold">populace</th>
            <th className="px-3 py-2 text-right font-semibold">Error</th>
            <th className="px-3 py-2 text-right font-semibold">Error %</th>
            <th className="px-3 py-2 font-semibold">Source</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={row.id} className="border-b border-border/60 align-top last:border-b-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{row.name}</span>
                  <StatusPill tone={row.in_sample ? "neutral" : "info"}>
                    {row.in_sample ? "in-sample" : "out-of-sample"}
                  </StatusPill>
                </div>
                {row.category && (
                  <div className="text-xs text-muted-foreground">{row.category}</div>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {fmtMoney(row.jct_score)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {fmtMoney(row.populace_estimate)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                {fmtSignedMoney(row.abs_error)}
              </td>
              <td
                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                  errorTone(row.abs_relative_error) === "positive"
                    ? "text-emerald-700"
                    : errorTone(row.abs_relative_error) === "negative"
                      ? "text-rose-700"
                      : "text-foreground"
                }`}
              >
                {pct(row.abs_relative_error)}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {row.jct_source_url ? (
                  <a
                    href={row.jct_source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {row.jct_source ?? "JCT"}
                  </a>
                ) : (
                  (row.jct_source ?? "—")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PopulaceReformsView() {
  const { data: releaseData, isLoading: releasesLoading } = usePopulaceReleases();
  const releases = releaseData?.releases ?? [];
  const [release, setRelease] = useState("");

  useEffect(() => {
    if (!release && releaseData?.latest_release_id) setRelease(releaseData.latest_release_id);
  }, [releaseData, release]);

  const { data, isLoading, error } = usePopulaceReforms(release || undefined);
  const { data: history } = usePopulaceReformHistory();

  const options = useMemo(
    () => releases.map((r) => ({ value: r.release_id, label: releaseLabel(r.release_id, r.date) })),
    [releases],
  );

  const trackedReforms = (history?.reforms ?? []).filter((r) => r.points.length >= 2);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Reform validation"
        description="How closely populace-US reproduces the budget effects of reforms that the Joint Committee on Taxation has officially scored. Each reform is simulated on the dataset by the build pipeline; we compare that estimate to the JCT score and track the gap release-over-release."
      />

      <SectionCard title="Release">
        {releasesLoading ? (
          <LoadingBlock label="Loading releases…" height="h-16" />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <ToolbarSelect label="Release" value={release} onChange={setRelease} options={options} />
          </div>
        )}
      </SectionCard>

      {isLoading ? (
        <LoadingBlock label="Loading reform validation…" />
      ) : error ? (
        <EmptyState
          title="Reform validation unavailable"
          description={error instanceof Error ? error.message : "Could not load reform validation."}
        />
      ) : data && !data.available ? (
        <EmptyState
          title="No reform validation published for this release yet"
          description={
            <>
              The populace build pipeline publishes <code>reform_validation.json</code> per release,
              scoring a set of JCT-scored reforms (OBBBA and others) on the dataset. This release
              doesn&apos;t have one yet ({data.expected_path}). Once a build publishes it, the
              populace-vs-JCT comparison appears here.
            </>
          }
          actions={
            <a
              href={POPULACE_REFORMS_ISSUE}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Track the producer work →
            </a>
          }
        />
      ) : data && data.available ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Out-of-sample mean |error|"
              value={pct(data.summary?.out_of_sample_mean_abs_relative_error)}
              tone={errorTone(data.summary?.out_of_sample_mean_abs_relative_error)}
              hint="the genuine fidelity test — reforms calibration never saw"
            />
            <KpiCard
              label="Out-of-sample within 10%"
              value={`${fmt(data.summary?.out_of_sample_within_10pct ?? 0, { digits: 0 })} / ${fmt(data.summary?.n_out_of_sample_scored ?? 0, { digits: 0 })}`}
              tone="positive"
              hint={`${fmt(data.summary?.n_out_of_sample ?? 0, { digits: 0 })} out-of-sample reforms`}
            />
            <KpiCard
              label="Reforms scored"
              value={fmt(data.summary?.n_scored ?? 0, { digits: 0 })}
              hint={`of ${fmt(data.summary?.n_reforms ?? 0, { digits: 0 })} (incl. in-sample targets)`}
            />
            <KpiCard
              label="All-reform mean |error|"
              value={pct(data.summary?.mean_abs_relative_error)}
              tone={errorTone(data.summary?.mean_abs_relative_error)}
              hint={`median ${pct(data.summary?.median_abs_relative_error)}`}
            />
          </div>

          <SectionCard
            title="populace vs JCT"
            description="A negative budget effect is a cost (revenue reduction). Error is populace − JCT; Error % is relative to the JCT score. Out-of-sample reforms are the real test; in-sample reforms are JCT tax-expenditure calibration targets the dataset was tuned to, shown for completeness."
            padded={false}
          >
            <ReformTable rows={data.rows ?? []} />
          </SectionCard>

          <SectionCard
            title="Run-over-run"
            description="How each reform's |error| against its JCT score has moved across releases that published a validation set. Down (and green) is better."
            padded={false}
          >
            {trackedReforms.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Reform</th>
                      <th className="px-3 py-2 font-semibold">Trend</th>
                      <th className="px-3 py-2 text-right font-semibold">Latest |error|</th>
                      <th className="px-3 py-2 text-right font-semibold">Δ vs prev</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackedReforms.map((r) => (
                      <tr key={r.id} className="border-b border-border/60 last:border-b-0">
                        <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                        <td className="px-3 py-2">
                          <Sparkline series={r} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {pct(r.latest_abs_relative_error)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            r.delta == null
                              ? "text-muted-foreground"
                              : r.delta < 0
                                ? "text-emerald-700"
                                : r.delta > 0
                                  ? "text-rose-700"
                                  : "text-muted-foreground"
                          }`}
                        >
                          {r.delta == null
                            ? "—"
                            : `${r.delta > 0 ? "+" : ""}${pct(r.delta)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-4">
                <StatusPill tone="info">
                  Run-over-run needs at least two releases with a published validation set — only one
                  is available so far.
                </StatusPill>
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
