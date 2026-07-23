"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtUnitValue, releaseLabel } from "@/components/shared/format";
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
  usePopulaceStagingRuns,
  type ReformHistorySeries,
  type ReformValidationRow,
} from "@/lib/api/hooks/use-populace";

const POPULACE_REFORMS_ISSUE = "https://github.com/PolicyEngine/populace/issues";

function pct(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { pct: true, digits: 1 });
}

function errorTone(absRel: number | null | undefined): "positive" | "neutral" | "negative" {
  if (absRel == null) return "neutral";
  if (absRel <= 0.1) return "positive";
  if (absRel <= 0.25) return "neutral";
  return "negative";
}

// ---------------------------------------------------------------------------
// Validation suites: rows group mechanically by their artifact `category`, so
// new producer checks (SOI backtest lines, CBO baselines, state scores…)
// appear as new sections without dashboard changes. SUITE_META only adds a
// methodology note where we have one — unknown categories still render.
// ---------------------------------------------------------------------------

interface SuiteMeta {
  blurb: string;
}

const SUITE_META: Record<string, SuiteMeta> = {
  OBBBA: {
    blurb:
      "Each OBBBA provision is reverted from the current-law baseline and the income-tax delta is compared to JCT's score (JCX-35-25). Benchmark is the first full fiscal year (FY2027): JCT scores fiscal-year cash receipts, so FY2026 captures only part of a tax year's effect. populace is a static calendar-year liability estimate, so it should run slightly below JCT's conventional scores. This release scored each provision in isolation against pre-OBBBA law, while JCT's lines are incremental — each conditioned on the lines above it — so interaction-heavy provisions (AMT especially: relief scored alone against post-TCJA-expiration law, vs JCT's line conditioned on the rate cuts) read worse than the model gap alone. The producer now stacks provisions in JCX order; the next release scores like-for-like.",
  },
  "Tax expenditure": {
    blurb:
      "The big credits and deductions are repealed outright (neutralized) and the income-tax delta is compared to the published JCT/Treasury tax-expenditure value. These provisions were not calibration targets — a genuine out-of-sample test of the underlying distributions.",
  },
  "JCT tax expenditure": {
    blurb:
      "Provisions the dataset is explicitly calibrated to — the optimizer saw these values, so near-zero error confirms the calibration converged, not that the model generalizes. Shown for completeness.",
  },
  "SOI baseline level": {
    blurb:
      "Simulated baseline totals compared to published IRS SOI actuals for tax items that are not calibration targets. TY2023 actuals vs a 2024-period dataset — a one-year vintage gap plus growth applies, so populace should run slightly above.",
  },
  "Federal EITC by state": {
    blurb:
      "The national federal EITC sliced to each state's households, compared to IRS EITC Central TY2024 administrative totals. The EITC is calibrated nationally (to an earlier SOI vintage), not per state — so a uniform few-percent undershoot is vintage, and state-specific deviations beyond it are geographic error. Flat-match state EITCs inherit this geography mechanically, which is why it is scored separately from the state-program suite.",
  },
  "Census state SPM": {
    blurb:
      "Baseline SPM poverty rates (overall and child) per state, compared to Census P60-287 2022–2024 three-year-average state SPM rates. Rates render as percentages, not dollars. Poverty is nowhere in the calibration target surface, so these are genuinely out-of-sample: person and child counts per state are calibrated (pinning the denominators), but the rates test the income and transfer distributions underneath.",
  },
};

interface Suite {
  category: string;
  rows: ReformValidationRow[];
  scored: number;
  within10: number;
  medianAbsError: number | null;
  worst: ReformValidationRow | null;
  inSample: "all" | "none" | "mixed";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildSuites(rows: ReformValidationRow[]): Suite[] {
  const byCategory = new Map<string, ReformValidationRow[]>();
  for (const row of rows) {
    const key = row.category ?? "Other checks";
    byCategory.set(key, [...(byCategory.get(key) ?? []), row]);
  }
  const suites = [...byCategory.entries()].map(([category, suiteRows]) => {
    const errors = suiteRows
      .map((r) => r.abs_relative_error)
      .filter((v): v is number => v != null);
    const scoredRows = suiteRows.filter((r) => r.abs_relative_error != null);
    const inSampleCount = suiteRows.filter((r) => r.in_sample).length;
    return {
      category,
      // Worst first inside a suite — problems surface at the top.
      rows: [...suiteRows].sort(
        (a, b) => (b.abs_relative_error ?? -1) - (a.abs_relative_error ?? -1),
      ),
      scored: scoredRows.length,
      within10: suiteRows.filter((r) => r.within_10pct).length,
      medianAbsError: median(errors),
      worst: scoredRows.length
        ? scoredRows.reduce((w, r) =>
            (r.abs_relative_error ?? 0) > (w.abs_relative_error ?? 0) ? r : w,
          )
        : null,
      inSample:
        inSampleCount === suiteRows.length
          ? ("all" as const)
          : inSampleCount === 0
            ? ("none" as const)
            : ("mixed" as const),
    };
  });
  // Out-of-sample suites (the genuine tests) first, largest first; fully
  // in-sample suites last.
  return suites.sort((a, b) => {
    const rank = (s: Suite) => (s.inSample === "all" ? 1 : 0);
    return rank(a) - rank(b) || b.rows.length - a.rows.length;
  });
}

function suiteAnchor(category: string): string {
  return `suite-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function SampleBadge({ inSample }: { inSample: Suite["inSample"] }) {
  if (inSample === "mixed") return null;
  return (
    <StatusPill tone={inSample === "all" ? "neutral" : "info"}>
      {inSample === "all" ? "in-sample" : "out-of-sample"}
    </StatusPill>
  );
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
            className={`w-1.5 rounded-sm ${good ? "swatch-pos" : "swatch-warn"}`}
            style={{ height: `${h}px` }}
            title={`${releaseLabel(p.release_id, p.date)}: ${pct(p.abs_relative_error)}`}
          />
        );
      })}
    </div>
  );
}

// |error| as a small bar next to the number, so a suite scans visually.
function ErrorCell({ absRel }: { absRel: number | null | undefined }) {
  const tone = errorTone(absRel);
  const color =
    tone === "positive" ? "swatch-pos" : tone === "negative" ? "swatch-neg" : "swatch-warn";
  const text =
    tone === "positive" ? "tone-pos" : tone === "negative" ? "tone-neg" : "text-foreground";
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={`font-medium tabular-nums ${absRel == null ? "text-muted-foreground" : text}`}>
        {pct(absRel)}
      </span>
      <span className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
        {absRel != null && (
          <span
            className={`block h-full rounded-full ${color}`}
            style={{ width: `${Math.min(Math.max(absRel, 0), 1) * 100}%` }}
          />
        )}
      </span>
    </div>
  );
}

function ReformTable({
  rows,
  history,
  showSamplePill,
}: {
  rows: ReformValidationRow[];
  history: Map<string, ReformHistorySeries>;
  showSamplePill: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!rows.length) {
    return <EmptyState title="No checks in this suite." variant="compact" />;
  }

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Check</th>
            <th className="px-3 py-2 text-right font-semibold">Benchmark</th>
            <th className="px-3 py-2 text-right font-semibold">populace</th>
            <th className="px-3 py-2 text-right font-semibold">Error</th>
            <th className="px-3 py-2 font-semibold">Trend</th>
            <th className="px-3 py-2 text-right font-semibold">Δ vs prev</th>
            <th className="px-3 py-2 font-semibold">Year</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = expanded.has(row.id);
            const series = history.get(row.id);
            const delta = series?.delta ?? null;
            return (
              <Fragment key={row.id}>
                <tr
                  onClick={() => toggle(row.id)}
                  className="cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] text-muted-foreground transition-transform ${
                          isOpen ? "rotate-90" : ""
                        }`}
                      >
                        ▸
                      </span>
                      <span className="font-medium text-foreground">{row.name}</span>
                      {showSamplePill && (
                        <StatusPill tone={row.in_sample ? "neutral" : "info"}>
                          {row.in_sample ? "in-sample" : "out-of-sample"}
                        </StatusPill>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    {fmtUnitValue(row.jct_score, row.unit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    {fmtUnitValue(row.populace_estimate, row.unit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <ErrorCell absRel={row.abs_relative_error} />
                  </td>
                  <td className="px-3 py-1.5">
                    {series ? (
                      <Sparkline series={series} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${
                      delta == null
                        ? "text-muted-foreground"
                        : delta < 0
                          ? "tone-pos"
                          : delta > 0
                            ? "tone-neg"
                            : "text-muted-foreground"
                    }`}
                  >
                    {delta == null ? "—" : `${delta > 0 ? "+" : ""}${pct(delta)}`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
                    {row.jct_benchmark_window ?? "—"}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/60 bg-muted/20">
                    <td colSpan={7} className="px-3 py-2 pl-9">
                      <div className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                        {row.description || "No description published for this check."}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Source:{" "}
                        {row.jct_source_url ? (
                          <a
                            href={row.jct_source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.jct_source ?? "JCT"}
                          </a>
                        ) : (
                          (row.jct_source ?? "—")
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
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

  const { data: stagingData } = usePopulaceStagingRuns();
  const options = useMemo(
    () => [
      ...releases.map((r) => ({ value: r.release_id, label: releaseLabel(r.release_id, r.date) })),
      // Candidate staging runs, reviewable with the same page before publish.
      ...(stagingData?.runs ?? []).map((r) => ({
        value: `staging:${r.run_id}`,
        label: `candidate · ${releaseLabel(r.run_id, r.updated_at)}${
          r.status && r.status !== "completed" ? ` (${r.status})` : ""
        }`,
      })),
    ],
    [releases, stagingData],
  );

  const historyById = useMemo(
    () =>
      new Map(
        (history?.reforms ?? [])
          .filter((r) => r.points.length >= 2)
          .map((r) => [r.id, r] as const),
      ),
    [history],
  );

  const suites = useMemo(() => buildSuites(data?.rows ?? []), [data]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="External checks"
        description="Every external check the build pipeline runs against an official figure — reform scores, tax-expenditure values, and baseline actuals — grouped into suites by what they test. Out-of-sample suites are the genuine fidelity tests; in-sample suites confirm the calibration converged. populace is a static calendar-year liability estimate on uprated survey data, so small gaps vs cash-receipts scores are expected. Trend and Δ track each check's |error| across releases (down and green is better)."
        actions={
          releasesLoading ? undefined : (
            <ToolbarSelect label="Release" value={release} onChange={setRelease} options={options} />
          )
        }
      />

      {isLoading || releasesLoading ? (
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
              hint="the genuine fidelity test — checks calibration never saw"
            />
            <KpiCard
              label="Out-of-sample within 10%"
              value={`${fmt(data.summary?.out_of_sample_within_10pct ?? 0, { digits: 0 })} / ${fmt(data.summary?.n_out_of_sample_scored ?? 0, { digits: 0 })}`}
              tone="positive"
              hint={`${fmt(data.summary?.n_out_of_sample ?? 0, { digits: 0 })} out-of-sample checks`}
            />
            <KpiCard
              label="Checks scored"
              value={fmt(data.summary?.n_scored ?? 0, { digits: 0 })}
              hint={`of ${fmt(data.summary?.n_reforms ?? 0, { digits: 0 })} across ${fmt(suites.length, { digits: 0 })} suites`}
            />
            <KpiCard
              label="All-check mean |error|"
              value={pct(data.summary?.mean_abs_relative_error)}
              tone={errorTone(data.summary?.mean_abs_relative_error)}
              hint={`median ${pct(data.summary?.median_abs_relative_error)}`}
            />
          </div>

          <SectionCard
            title="Validation suites"
            description="One row per suite of checks; click a suite to jump to its table. New producer checks group in automatically by category."
            padded={false}
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Suite</th>
                  <th className="px-3 py-2 font-semibold">Sample</th>
                  <th className="px-3 py-2 text-right font-semibold">Checks</th>
                  <th className="px-3 py-2 text-right font-semibold">Within 10%</th>
                  <th className="px-3 py-2 text-right font-semibold">Median |error|</th>
                  <th className="px-3 py-2 font-semibold">Worst check</th>
                </tr>
              </thead>
              <tbody>
                {suites.map((suite) => (
                  <tr
                    key={suite.category}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <td className="px-3 py-2">
                      <a
                        href={`#${suiteAnchor(suite.category)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {suite.category}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <SampleBadge inSample={suite.inSample} />
                      {suite.inSample === "mixed" && (
                        <span className="text-xs text-muted-foreground">mixed</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{suite.rows.length}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        suite.scored > 0 && suite.within10 === suite.scored
                          ? "tone-pos"
                          : ""
                      }`}
                    >
                      {suite.within10} / {suite.scored}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium tabular-nums ${
                        errorTone(suite.medianAbsError) === "positive"
                          ? "tone-pos"
                          : errorTone(suite.medianAbsError) === "negative"
                            ? "tone-neg"
                            : "text-foreground"
                      }`}
                    >
                      {pct(suite.medianAbsError)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {suite.worst ? (
                        <>
                          {suite.worst.name}{" "}
                          <span className="font-medium tone-neg">
                            {pct(suite.worst.abs_relative_error)}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          {suites.map((suite) => (
            <div key={suite.category} id={suiteAnchor(suite.category)} className="scroll-mt-4">
              <SectionCard
                title={
                  <span className="flex items-center gap-2">
                    {suite.category}
                    <SampleBadge inSample={suite.inSample} />
                    <span className="font-normal text-muted-foreground">
                      {suite.within10}/{suite.scored} within 10% · median |error|{" "}
                      {pct(suite.medianAbsError)}
                    </span>
                  </span>
                }
                description={
                  <>
                    {SUITE_META[suite.category]?.blurb ?? ""} Click a row for its
                    methodology and source.
                  </>
                }
                padded={false}
              >
                <ReformTable
                  rows={suite.rows}
                  history={historyById}
                  showSamplePill={suite.inSample === "mixed"}
                />
              </SectionCard>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
