"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, fmtSigned, releaseLabel } from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  usePopulaceDemographics,
  usePopulaceDemographicsHistory,
  usePopulaceReleases,
  type AgeBandRow,
} from "@/lib/api/hooks/use-populace";

function pct(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { pct: true, digits: 1 });
}

function errorTone(absRel: number | null | undefined): "positive" | "neutral" | "negative" {
  if (absRel == null) return "neutral";
  if (absRel <= 0.05) return "positive";
  if (absRel <= 0.15) return "neutral";
  return "negative";
}

// Two overlaid share bars: populace (solid) vs Census benchmark (outline).
function ShareBar({ share, benchmarkShare }: { share: number | null; benchmarkShare: number | null }) {
  const max = Math.max(share ?? 0, benchmarkShare ?? 0, 0.001);
  const w = (v: number | null) => `${Math.round(((v ?? 0) / max) * 100)}%`;
  return (
    <div className="relative h-4 w-full min-w-[120px] rounded bg-muted/40">
      {benchmarkShare != null && (
        <div
          className="absolute inset-y-0 left-0 rounded border border-dashed border-slate-400"
          style={{ width: w(benchmarkShare) }}
          title={`Census ${pct(benchmarkShare)}`}
        />
      )}
      {share != null && (
        <div
          className="absolute inset-y-[3px] left-0 rounded bg-primary/70"
          style={{ width: w(share) }}
          title={`populace ${pct(share)}`}
        />
      )}
    </div>
  );
}

function AgeTable({ bands }: { bands: AgeBandRow[] }) {
  if (!bands.length) return <EmptyState title="No age bands in this release." variant="compact" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Age</th>
            <th className="px-3 py-2 text-right font-semibold">Population</th>
            <th className="px-3 py-2 text-right font-semibold">Share</th>
            <th className="px-3 py-2 text-right font-semibold">Census</th>
            <th className="px-3 py-2 font-semibold">Share vs Census</th>
            <th className="px-3 py-2 text-right font-semibold">Error</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.label} className="border-b border-border/60 last:border-b-0">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-foreground">{b.label}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                {fmtCompact(b.population)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                {pct(b.share)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                {fmtCompact(b.benchmark)}
              </td>
              <td className="px-3 py-1.5">
                <ShareBar share={b.share ?? null} benchmarkShare={b.benchmark_share ?? null} />
              </td>
              <td
                className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${
                  errorTone(b.abs_relative_error) === "positive"
                    ? "text-emerald-700"
                    : errorTone(b.abs_relative_error) === "negative"
                      ? "text-rose-700"
                      : "text-foreground"
                }`}
              >
                {b.relative_error == null ? "—" : fmtSigned(b.relative_error, { pct: true, digits: 0 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PopulaceDemographicsView() {
  const { data: releaseData, isLoading: releasesLoading } = usePopulaceReleases();
  const releases = releaseData?.releases ?? [];
  const [release, setRelease] = useState("");

  useEffect(() => {
    if (!release && releaseData?.latest_release_id) setRelease(releaseData.latest_release_id);
  }, [releaseData, release]);

  const { data, isLoading, error } = usePopulaceDemographics(release || undefined);
  const { data: history } = usePopulaceDemographicsHistory();

  const options = useMemo(
    () => releases.map((r) => ({ value: r.release_id, label: releaseLabel(r.release_id, r.date) })),
    [releases],
  );

  const trend = (history?.points ?? []).filter((p) => p.total_population != null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Demographics"
        description="The dataset's weighted population by age band, against the US Census age structure. The fiscal release does not calibrate the age distribution, so this is an emergent diagnostic — a positive error means populace has more people in that band than Census."
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
        <LoadingBlock label="Loading demographics…" />
      ) : error ? (
        <EmptyState
          title="Demographics unavailable"
          description={error instanceof Error ? error.message : "Could not load demographics."}
        />
      ) : data && !data.available ? (
        <EmptyState
          title="No demographics published for this release yet"
          description={
            <>
              The populace build publishes <code>demographics.json</code> (weighted population by
              age) per release. This release doesn&apos;t have one yet ({data.expected_path}). Once a
              build publishes it, the age distribution appears here.
            </>
          }
        />
      ) : data && data.available ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Total population"
              value={fmtCompact(data.total_population)}
              hint={
                data.benchmark_total_population
                  ? `Census ${fmtCompact(data.benchmark_total_population)}`
                  : `period ${data.period ?? "—"}`
              }
            />
            <KpiCard
              label="Total vs Census"
              value={
                data.summary?.total_vs_benchmark == null
                  ? "—"
                  : fmtSigned(data.summary.total_vs_benchmark, { pct: true, digits: 1 })
              }
              tone={errorTone(
                data.summary?.total_vs_benchmark == null
                  ? null
                  : Math.abs(data.summary.total_vs_benchmark),
              )}
            />
            <KpiCard
              label="Mean band |error|"
              value={pct(data.summary?.mean_abs_relative_error)}
              tone={errorTone(data.summary?.mean_abs_relative_error)}
              hint={`${fmt(data.summary?.n_benchmarked ?? 0, { digits: 0 })} bands vs Census`}
            />
            <KpiCard
              label="Largest band |error|"
              value={pct(data.summary?.max_abs_relative_error)}
              tone={errorTone(data.summary?.max_abs_relative_error)}
            />
          </div>

          <SectionCard
            title="Population by age"
            description={
              data.benchmark_source
                ? `Benchmark: ${data.benchmark_source}. Bars compare populace's share (solid) to the Census share (dashed) within each band.`
                : "Weighted population per age band."
            }
            padded={false}
          >
            <AgeTable bands={data.bands ?? []} />
          </SectionCard>

          <SectionCard
            title="Run-over-run"
            description="Total population and mean age-band error against Census across releases."
            padded={false}
          >
            {trend.length >= 1 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Release</th>
                      <th className="px-3 py-2 text-right font-semibold">Total population</th>
                      <th className="px-3 py-2 text-right font-semibold">Total vs Census</th>
                      <th className="px-3 py-2 text-right font-semibold">Mean band |error|</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((p) => (
                      <tr key={p.release_id} className="border-b border-border/60 last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-1.5">
                          {releaseLabel(p.release_id, p.date)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmtCompact(p.total_population)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {p.total_vs_benchmark == null
                            ? "—"
                            : fmtSigned(p.total_vs_benchmark, { pct: true, digits: 1 })}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {pct(p.mean_abs_relative_error)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-4">
                <StatusPill tone="info">
                  Run-over-run appears once more than one release publishes demographics.
                </StatusPill>
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
