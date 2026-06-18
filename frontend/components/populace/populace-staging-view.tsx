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
                <StatusPill tone={statusTone(run.status)}>{run.status || "unknown"}</StatusPill>
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
  const status = typeof progress.status === "string" ? progress.status : null;
  const stage = typeof progress.stage === "string" ? progress.stage : null;
  const message = typeof progress.message === "string" ? progress.message : null;
  const updatedAt = typeof progress.updated_at === "string" ? progress.updated_at : null;
  const candidateReleaseId = runData?.candidate_release_id ?? selectedRun;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Staging runs"
        description="Monitor Populace build candidates before they are promoted to the published Hugging Face release channel."
      />

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <SectionCard
          title="Runs"
          description={
            runsData
              ? `${runs.length} runs from ${runsData.source_repo}`
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
                  hint={stage || "no stage reported"}
                  tone={status === "failed" ? "negative" : status === "passed" ? "positive" : "neutral"}
                />
                <KpiCard
                  label="Candidate"
                  value={releaseLabel(candidateReleaseId)}
                  hint={selectedRun}
                />
                <KpiCard
                  label="Last update"
                  value={timeLabel(updatedAt)}
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
                </SectionCard>
              ) : null}

              <SectionCard title="Stage events" padded={false}>
                {(runData.events ?? []).length ? (
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 font-semibold">Time</th>
                          <th className="px-3 py-2 font-semibold">Stage</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(runData.events ?? []).slice().reverse().map((event, index) => (
                          <tr key={index} className="border-b border-border/60 last:border-b-0">
                            <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                              {timeLabel(typeof event.time === "string" ? event.time : null)}
                            </td>
                            <td className="px-3 py-1.5">{String(event.stage ?? "—")}</td>
                            <td className="px-3 py-1.5">{String(event.status ?? "—")}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {String(event.message ?? "—")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="No stage events yet." variant="compact" />
                )}
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
