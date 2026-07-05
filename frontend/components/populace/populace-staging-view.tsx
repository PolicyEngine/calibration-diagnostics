"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import {
  fmt,
  fmtCompact,
  fmtMoney,
  fmtSignedMoney,
  releaseLabel,
} from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import {
  usePopulaceStagingCompare,
  usePopulaceStagingRun,
  usePopulaceStagingRuns,
  type PopulaceStagingRunSummary,
  type ReformValidationRow,
} from "@/lib/api/hooks/use-populace";

type LossKind = "normalized_target_loss" | "raw_optimizer_objective" | undefined;

function fmtLoss(value: number | null | undefined, kind: LossKind): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "normalized_target_loss") return fmt(value, { digits: value < 1 ? 4 : 3 });
  return fmtCompact(value);
}

function pct(value: number | null | undefined) {
  return value == null ? "—" : fmt(value, { pct: true, digits: 1 });
}

function validationTone(absRel: number | null | undefined): "positive" | "neutral" | "negative" {
  if (absRel == null) return "neutral";
  if (absRel <= 0.1) return "positive";
  if (absRel <= 0.25) return "neutral";
  return "negative";
}

function statusTone(status: string | null | undefined): StatusTone {
  if (status === "passed" || status === "published") return "success";
  if (status === "failed") return "danger";
  if (status === "stalled") return "warning";
  if (status === "running" || status === "queued") return "info";
  return "neutral";
}

function timeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// A "running" run that hasn't reported for two hours is dead in practice —
// builds emit events at least every stage, and stages run minutes, not hours.
const STALL_MS = 2 * 60 * 60 * 1000;

function effectiveStatus(
  status: string | null | undefined,
  updatedAt: string | null | undefined,
): string | null {
  if (status !== "running" && status !== "queued") return status ?? null;
  const t = updatedAt ? new Date(updatedAt).valueOf() : NaN;
  if (Number.isFinite(t) && Date.now() - t > STALL_MS) return "stalled";
  return status ?? null;
}

function agoLabel(value: string | null | undefined): string {
  const t = value ? new Date(value).valueOf() : NaN;
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
}

// Human rendering for the small details dicts events carry (n_targets,
// learning_rate, gate results, repair factors…).
function detailChips(details: unknown): [string, string][] {
  if (!details || typeof details !== "object") return [];
  return Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v == null || ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 8)
    .map(([k, v]) => {
      const num = typeof v === "number";
      const shown = num
        ? Math.abs(v as number) >= 1000
          ? fmtCompact(v as number)
          : fmt(v as number, { digits: Math.abs(v as number) < 1 ? 4 : 2 })
        : String(v);
      return [k, shown] as [string, string];
    });
}

function durationLabel(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}

function RunList({
  runs,
  selected,
  onSelect,
}: {
  runs: PopulaceStagingRunSummary[];
  selected: string;
  onSelect: (runId: string) => void;
}) {
  if (!runs.length) {
    return (
      <EmptyState
        title="No staging runs found."
        description="Run Populace with staging telemetry enabled to publish progress here."
        variant="compact"
      />
    );
  }
  return (
    <div className="max-h-[72vh] overflow-y-auto rounded-md border border-border">
      <div className="divide-y divide-border/60">
        {runs.map((run) => {
          const active = run.run_id === selected;
          return (
            <button
              key={run.run_id}
              type="button"
              onClick={() => onSelect(run.run_id)}
              className={`block w-full px-3 py-2 text-left ${
                active ? "bg-primary/10" : "hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">
                    {releaseLabel(run.candidate_release_id || run.run_id)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {run.stage || "—"} · {timeLabel(run.updated_at)}
                  </div>
                </div>
                {(() => {
                  const shown = effectiveStatus(run.status, run.updated_at);
                  return (
                    <StatusPill tone={statusTone(shown)}>{shown || "unknown"}</StatusPill>
                  );
                })()}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LossSparkline({ values }: { values: number[] }) {
  if (!values.length) return <div className="text-sm text-muted-foreground">No loss points yet.</div>;
  const finite = values.filter((value) => Number.isFinite(value));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  return (
    <div className="flex h-24 items-end gap-0.5 rounded-md border border-border bg-muted/20 p-2">
      {finite.slice(-120).map((value, index) => (
        <div
          key={`${index}-${value}`}
          className="min-w-0 flex-1 rounded-t bg-primary/70"
          style={{ height: `${Math.max(4, ((value - min) / span) * 88)}px` }}
          title={fmt(value, { digits: 4 })}
        />
      ))}
    </div>
  );
}

function ReformValidationTable({ rows }: { rows: ReformValidationRow[] }) {
  const ordered = [...rows]
    .filter((row) => row.populace_estimate != null || row.jct_score != null)
    .sort((a, b) => Number(a.in_sample ?? false) - Number(b.in_sample ?? false));
  if (!ordered.length) {
    return <EmptyState title="No reform validation rows yet." variant="compact" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Test</th>
            <th className="px-3 py-2 text-right font-semibold">Benchmark</th>
            <th className="px-3 py-2 text-right font-semibold">Candidate</th>
            <th className="px-3 py-2 text-right font-semibold">Diff</th>
            <th className="px-3 py-2 text-right font-semibold">Error</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={row.id} className="border-b border-border/60 last:border-b-0">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{row.name}</span>
                  <StatusPill tone={row.in_sample ? "neutral" : "info"}>
                    {row.in_sample ? "in-sample" : "out-of-sample"}
                  </StatusPill>
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.category || "Reform score"}
                </div>
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
                  validationTone(row.abs_relative_error) === "positive"
                    ? "text-emerald-700"
                    : validationTone(row.abs_relative_error) === "negative"
                      ? "text-rose-700"
                      : "text-foreground"
                }`}
              >
                {pct(row.abs_relative_error)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PopulaceStagingView() {
  const { data: runsData, isLoading: runsLoading, error: runsError } = usePopulaceStagingRuns();
  const runs = runsData?.runs ?? [];
  const [selectedRun, setSelectedRun] = useState("");

  useEffect(() => {
    if (!selectedRun && runs[0]) setSelectedRun(runs[0].run_id);
  }, [runs, selectedRun]);

  const { data: runData, isLoading: runLoading, error: runError } =
    usePopulaceStagingRun(selectedRun);
  const { data: compareData } = usePopulaceStagingCompare(
    runData?.has_calibration ? selectedRun : undefined,
    "latest",
  );
  const calibrationEvents = runData?.calibration_progress?.events ?? [];
  const lossValues = useMemo(
    () =>
      calibrationEvents
        .map((event) => (typeof event.loss === "number" ? event.loss : null))
        .filter((value): value is number => value != null),
    [calibrationEvents],
  );
  const lastCalibrationEvent = calibrationEvents.at(-1);
  const progress = runData?.progress ?? {};
  const rawStatus = typeof progress.status === "string" ? progress.status : null;
  const stage = typeof progress.stage === "string" ? progress.stage : null;
  const message = typeof progress.message === "string" ? progress.message : null;
  const updatedAt = typeof progress.updated_at === "string" ? progress.updated_at : null;
  const status = effectiveStatus(rawStatus, updatedAt);
  const progressDetails = detailChips(progress.details);
  const candidateReleaseId = runData?.candidate_release_id ?? selectedRun;
  const buildManifest = (runData?.build_manifest ?? null) as Record<string, unknown> | null;
  const artifacts = ((runData?.run_manifest as Record<string, unknown> | null)?.artifacts ??
    {}) as Record<string, { path?: string; staging_path?: string }>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Staging candidates"
        description="Monitor Populace build candidates before they are promoted to the published Hugging Face release channel."
      />

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <SectionCard
          title="Runs"
          description={
            runsData
              ? `${runs.length} ${runs.length === 1 ? "run" : "runs"} from ${runsData.source_repo}`
              : "Loading staging run index."
          }
        >
          {runsLoading ? (
            <LoadingBlock label="Loading staging runs…" height="h-40" />
          ) : runsError ? (
            <EmptyState
              title="Staging runs unavailable"
              description={runsError instanceof Error ? runsError.message : "Unknown error."}
              variant="compact"
            />
          ) : (
            <RunList runs={runs} selected={selectedRun} onSelect={setSelectedRun} />
          )}
        </SectionCard>

        <div className="flex flex-col gap-5">
          {!selectedRun ? (
            <EmptyState title="Select a staging run." />
          ) : runLoading ? (
            <LoadingBlock label="Loading staging run…" />
          ) : runError || !runData ? (
            <EmptyState
              title="Staging run unavailable"
              description={runError instanceof Error ? runError.message : "Unknown error."}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard
                  label="Status"
                  value={status || "unknown"}
                  hint={
                    status === "stalled"
                      ? `no update since ${timeLabel(updatedAt)} — died at ${stage ?? "?"}`
                      : stage || "no stage reported"
                  }
                  tone={
                    status === "failed" || status === "stalled"
                      ? "negative"
                      : status === "passed"
                        ? "positive"
                        : "neutral"
                  }
                />
                <KpiCard
                  label="Candidate"
                  value={releaseLabel(candidateReleaseId)}
                  hint={selectedRun}
                />
                <KpiCard
                  label="Last update"
                  value={`${timeLabel(updatedAt)}${agoLabel(updatedAt) ? ` · ${agoLabel(updatedAt)}` : ""}`}
                  hint={message || "progress.json"}
                />
                <KpiCard
                  label="Calibration points"
                  value={fmt(calibrationEvents.length, { digits: 0 })}
                  hint={
                    lastCalibrationEvent?.epoch && lastCalibrationEvent?.epochs
                      ? `epoch ${lastCalibrationEvent.epoch} of ${lastCalibrationEvent.epochs}`
                      : "waiting for calibration"
                  }
                />
              </div>

              {progressDetails.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium">Last stage detail:</span>
                  {progressDetails.map(([k, v]) => (
                    <span
                      key={k}
                      className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                    >
                      {k}={v}
                    </span>
                  ))}
                </div>
              )}

              <SectionCard
                title="Calibration progress"
                description="Loss points emitted by the Populace calibrator while the staging build runs."
              >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <LossSparkline values={lossValues} />
                  <div className="grid gap-2 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        Latest loss
                      </div>
                      <div className="font-mono">{fmt(lossValues.at(-1), { digits: 4 })}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        Best loss
                      </div>
                      <div className="font-mono">
                        {lossValues.length ? fmt(Math.min(...lossValues), { digits: 4 }) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        Stage
                      </div>
                      <StatusPill tone={statusTone(status)}>{stage || status || "unknown"}</StatusPill>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {runData.calibration ? (
                <SectionCard
                  title="Candidate calibration"
                  description="Final calibration diagnostics uploaded by this staging run."
                >
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <KpiCard
                      label="Targets"
                      value={fmt(runData.calibration.total_targets, { digits: 0 })}
                      hint={`${fmt(runData.calibration.included_target_count, { digits: 0 })} included`}
                    />
                    <KpiCard
                      label="Within 10%"
                      value={fmt(runData.calibration.fraction_within_10pct, {
                        pct: true,
                        digits: 0,
                      })}
                      hint={`${fmt(runData.calibration.within_tolerance_count, { digits: 0 })} in tolerance`}
                    />
                    <KpiCard
                      label={
                        runData.calibration.loss_kind === "normalized_target_loss"
                          ? "Final normalized loss"
                          : "Final raw loss"
                      }
                      value={fmtLoss(
                        runData.calibration.final_loss,
                        runData.calibration.loss_kind,
                      )}
                      hint={`initial ${fmtLoss(
                        runData.calibration.initial_loss,
                        runData.calibration.loss_kind,
                      )}`}
                    />
                    <KpiCard
                      label="Non-zero records"
                      value={fmt(runData.calibration.n_nonzero, { digits: 0 })}
                      hint={`${fmt(runData.calibration.n_records, { digits: 0 })} records`}
                    />
                  </div>
                </SectionCard>
              ) : (
                <SectionCard
                  title="Candidate calibration"
                  description="This appears once the run uploads calibration_diagnostics.json."
                >
                  <EmptyState title="Calibration diagnostics not uploaded yet." variant="compact" />
                </SectionCard>
              )}

              {runData.reform_validation ? (
                <SectionCard
                  title="Reform validation"
                  description="External score tests uploaded by this staging run. Out-of-sample rows are the main signal; in-sample rows were direct or near-direct calibration targets."
                  padded={false}
                >
                  <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
                    <KpiCard
                      label="Out-of-sample mean |error|"
                      value={pct(
                        runData.reform_validation.summary
                          ?.out_of_sample_mean_abs_relative_error,
                      )}
                      tone={validationTone(
                        runData.reform_validation.summary
                          ?.out_of_sample_mean_abs_relative_error,
                      )}
                      hint="reforms calibration did not directly see"
                    />
                    <KpiCard
                      label="Out-of-sample within 10%"
                      value={`${fmt(
                        runData.reform_validation.summary?.out_of_sample_within_10pct ?? 0,
                        { digits: 0 },
                      )} / ${fmt(
                        runData.reform_validation.summary?.n_out_of_sample_scored ?? 0,
                        { digits: 0 },
                      )}`}
                      hint={`${fmt(
                        runData.reform_validation.summary?.n_out_of_sample ?? 0,
                        { digits: 0 },
                      )} out-of-sample tests`}
                    />
                    <KpiCard
                      label="Tests scored"
                      value={fmt(runData.reform_validation.summary?.n_scored ?? 0, {
                        digits: 0,
                      })}
                      hint={`${fmt(runData.reform_validation.summary?.n_reforms ?? 0, {
                        digits: 0,
                      })} total tests`}
                    />
                    <KpiCard
                      label="All-test mean |error|"
                      value={pct(runData.reform_validation.summary?.mean_abs_relative_error)}
                      tone={validationTone(
                        runData.reform_validation.summary?.mean_abs_relative_error,
                      )}
                      hint="includes in-sample rows"
                    />
                  </div>
                  <ReformValidationTable rows={runData.reform_validation.rows ?? []} />
                </SectionCard>
              ) : (
                <SectionCard
                  title="Reform validation"
                  description="This appears once the run uploads reform_validation.json."
                >
                  <EmptyState title="Reform validation not uploaded yet." variant="compact" />
                </SectionCard>
              )}

              {compareData?.available !== false && compareData?.summary ? (
                <SectionCard
                  title="Candidate vs latest release"
                  description="Target-level diff between production latest and this staging candidate."
                >
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <KpiCard
                      label="Common targets"
                      value={fmt(compareData.summary.common, { digits: 0 })}
                      hint={`+${fmt(compareData.summary.added, { digits: 0 })} / -${fmt(compareData.summary.removed, { digits: 0 })}`}
                    />
                    <KpiCard
                      label="Improved"
                      value={fmt(compareData.summary.improved, { digits: 0 })}
                      tone="positive"
                      hint={`${fmt(compareData.summary.regressed, { digits: 0 })} regressed`}
                    />
                    <KpiCard
                      label="Latest targets"
                      value={fmt(compareData.a.total_targets, { digits: 0 })}
                      hint={releaseLabel(compareData.a.release_id)}
                    />
                    <KpiCard
                      label="Candidate targets"
                      value={fmt(compareData.b.total_targets, { digits: 0 })}
                      hint={releaseLabel(compareData.b.release_id)}
                    />
                  </div>
                  {(() => {
                    const regressions = (compareData.rows ?? [])
                      .filter(
                        (row) =>
                          (row.abs_rel_delta ?? 0) > 1e-9 &&
                          // Drop tiny-denominator artifacts (>1000% errors),
                          // same convention as the release highlights.
                          Math.abs(row.b_relative_error ?? 0) <= 10 &&
                          Math.abs(row.a_relative_error ?? 0) <= 10,
                      )
                      .slice(0, 12);
                    if (!regressions.length) return null;
                    const pctOrDash = (v: number | null | undefined) =>
                      v == null ? "—" : fmt(Math.abs(v), { pct: true, digits: 1 });
                    return (
                      <div className="mt-4 overflow-x-auto">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Biggest regressions
                        </div>
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                              <th className="px-3 py-2 font-semibold">Target</th>
                              <th className="px-3 py-2 text-right font-semibold">Latest |error|</th>
                              <th className="px-3 py-2 text-right font-semibold">Candidate |error|</th>
                              <th className="px-3 py-2 text-right font-semibold">Δ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {regressions.map((row) => (
                              <tr key={row.name} className="border-b border-border/60 last:border-b-0">
                                <td className="px-3 py-1.5">
                                  <span className="font-medium text-foreground">
                                    {row.variable ?? row.name}
                                  </span>
                                  {row.target_label ? (
                                    <span className="text-xs text-muted-foreground"> · {row.target_label}</span>
                                  ) : null}
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                  {pctOrDash(row.a_relative_error)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                                  {pctOrDash(row.b_relative_error)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-rose-700">
                                  +{fmt(row.abs_rel_delta, { pct: true, digits: 1 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </SectionCard>
              ) : null}

              <SectionCard
                title="Stage timeline"
                description="Every stage the build reported, with how long it ran and the numbers it logged. A run that stops mid-list without a failed event died silently — the last row is where."
                padded={false}
              >
                {(runData.events ?? []).length ? (
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-semibold">Stage</th>
                          <th className="px-3 py-2 font-semibold">Started</th>
                          <th className="px-3 py-2 text-right font-semibold">Duration</th>
                          <th className="px-3 py-2 font-semibold">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(runData.events ?? []).map((event, index, all) => {
                          const time = typeof event.time === "string" ? event.time : null;
                          const next = all[index + 1];
                          const nextTime =
                            next && typeof next.time === "string" ? next.time : null;
                          const duration =
                            time && nextTime
                              ? new Date(nextTime).valueOf() - new Date(time).valueOf()
                              : null;
                          const chips = detailChips(event.details);
                          const failed = event.status === "failed";
                          return (
                            <tr
                              key={index}
                              className={`border-b border-border/60 last:border-b-0 ${
                                failed ? "bg-rose-50/60" : ""
                              }`}
                            >
                              <td className="whitespace-nowrap px-3 py-1.5">
                                <span className={failed ? "font-medium text-rose-700" : ""}>
                                  {String(event.stage ?? "—")}
                                </span>
                                {failed && (
                                  <StatusPill tone="danger">failed</StatusPill>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                                {timeLabel(time)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                                {index === all.length - 1 &&
                                event.stage !== "complete" &&
                                !failed
                                  ? status === "stalled"
                                    ? "⚠ last event"
                                    : "…"
                                  : durationLabel(duration)}
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="text-xs text-muted-foreground">
                                  {String(event.message ?? "—")}
                                </div>
                                {chips.length > 0 && (
                                  <div className="mt-0.5 flex flex-wrap gap-1">
                                    {chips.map(([k, v]) => (
                                      <span
                                        key={k}
                                        className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                                      >
                                        {k}={v}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No stage events yet." variant="compact" />
                )}
              </SectionCard>

              {buildManifest && (
                <SectionCard
                  title="Build manifest"
                  description="Exactly what produced this candidate — code commit, package versions, artifact hashes, and gate results."
                >
                  <div className="flex flex-col gap-4">
                    {(() => {
                      const code = (buildManifest.code ?? {}) as Record<string, unknown>;
                      const runtime = (buildManifest.runtime ?? {}) as Record<string, unknown>;
                      const gates = (buildManifest.gates ?? {}) as Record<string, unknown>;
                      const dataset = (buildManifest.dataset ?? {}) as Record<string, unknown>;
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-4">
                            <div className="flex justify-between gap-2 border-b border-border/40 py-1">
                              <span className="text-muted-foreground">Commit</span>
                              <a
                                href={`https://github.com/PolicyEngine/populace/commit/${String(code.git_commit ?? "")}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-primary hover:underline"
                              >
                                {String(code.git_commit ?? "—").slice(0, 7)}
                                {code.git_dirty ? " (dirty)" : ""}
                              </a>
                            </div>
                            {Object.entries(runtime)
                              .filter(([k]) =>
                                ["python", "policyengine-us", "policyengine-core", "torch"].includes(k),
                              )
                              .map(([k, v]) => (
                                <div
                                  key={k}
                                  className="flex justify-between gap-2 border-b border-border/40 py-1"
                                >
                                  <span className="text-muted-foreground">{k}</span>
                                  <span className="font-mono text-foreground">{String(v)}</span>
                                </div>
                              ))}
                            <div className="flex justify-between gap-2 border-b border-border/40 py-1">
                              <span className="text-muted-foreground">Dataset sha256</span>
                              <span className="font-mono text-foreground">
                                {String(dataset.sha256 ?? "—").slice(0, 12)}…
                              </span>
                            </div>
                          </div>
                          {Object.keys(gates).length > 0 && (
                            <div>
                              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Gates
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(gates).map(([name, result]) => {
                                  const r = (result ?? {}) as Record<string, unknown>;
                                  const passed = r.passed === true;
                                  const failures = Array.isArray(r.failures) ? r.failures : [];
                                  return (
                                    <div
                                      key={name}
                                      className={`rounded-md border px-2 py-1 text-xs ${
                                        passed
                                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                          : "border-rose-200 bg-rose-50 text-rose-800"
                                      }`}
                                    >
                                      <span className="font-medium">{name}</span>{" "}
                                      {passed ? "passed" : "failed"}
                                      {failures.length > 0 && (
                                        <span className="ml-1 font-mono text-[10px]">
                                          {failures.map((f) => String(f)).join("; ")}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </SectionCard>
              )}

              {Object.keys(artifacts).length > 0 && (
                <SectionCard
                  title="Uploaded artifacts"
                  description="Files this run has published to the staging repo so far."
                  padded={false}
                >
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {Object.entries(artifacts).map(([name, meta]) => (
                        <tr key={name} className="border-b border-border/60 last:border-b-0">
                          <td className="px-3 py-1.5 font-medium">{name}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">
                            {meta.staging_path ? (
                              <a
                                href={`https://huggingface.co/datasets/${runData.source_repo}/blob/main/${meta.staging_path}`}
                                target="_blank"
                                rel="noreferrer"
                                className="underline decoration-dotted underline-offset-2 hover:text-primary"
                              >
                                {meta.staging_path}
                              </a>
                            ) : (
                              (meta.path ?? "—")
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
