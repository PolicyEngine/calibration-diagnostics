"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useCountry } from "@/components/layout/country-context";
import { StagingTargetChangeMap } from "@/components/microcosm/staging-target-change-map";
import { EmptyState } from "@/components/shared/empty-state";
import {
  fmtUnitValue,
  fmt,
  fmtCompact,
  fmtMoney,
  fmtSignedMoney,
  shortReleaseId,
} from "@/components/shared/format";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import {
  overviewMetricLabelTypographyClassName,
  overviewMetricValueClassName,
} from "@/components/shared/overview-metric";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import {
  useMicrocosmStagingCompare,
  useMicrocosmStagingRun,
  useMicrocosmStagingRuns,
  type MicrocosmStagingRunResponse,
  type MicrocosmStagingRunSummary,
  type ReformValidationRow,
} from "@/lib/api/hooks/use-microcosm";
import { countryRegistration, hasCapability } from "@/lib/microcosm/countries";
import {
  formatStagingCurrentStatus,
  formatStagingStatus,
} from "@/lib/microcosm/staging-status";
import { targetChangeMapIdentity } from "@/lib/microcosm/target-change-visualization";

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

function timestampFromId(value: string | null | undefined): string | null {
  const match = value?.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

function runStartTime(run: MicrocosmStagingRunSummary): string | null | undefined {
  return (
    run.started_at ??
    timestampFromId(run.candidate_release_id) ??
    timestampFromId(run.run_id) ??
    run.updated_at
  );
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
  runs: MicrocosmStagingRunSummary[];
  selected: string;
  onSelect: (runId: string) => void;
}) {
  if (!runs.length) {
    return (
      <EmptyState
        title="No staging runs found."
        description="Run Microcosm with staging telemetry enabled to publish progress here."
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
                    {timeLabel(runStartTime(run))} ·{" "}
                    {shortReleaseId(run.candidate_release_id || run.run_id)}
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

function RunInternalsPanel({
  runData,
  lossValues,
  status,
  stage,
  buildManifest,
  artifacts,
  open,
  onOpenChange,
  className = "",
}: {
  runData: MicrocosmStagingRunResponse;
  lossValues: number[];
  status: string | null;
  stage: string | null;
  buildManifest: Record<string, unknown> | null;
  artifacts: Record<string, { path?: string; staging_path?: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className={`group overflow-hidden rounded-lg border border-border/80 bg-card shadow-[var(--elev-1)] ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg bg-muted/20 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight text-foreground">Run internals</div>
          <div className="mt-1 max-w-2xl text-xs leading-snug text-muted-foreground">
            Optimizer progress, stage timeline with logged numbers, build manifest (versions,
            hashes, validation results), and uploaded artifacts.
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-5 border-t border-border p-4">
        <SectionCard
          title="Calibration progress"
          description="Loss points emitted by the Microcosm calibrator while the staging build runs."
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
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Stage</div>
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
                value={fmtLoss(runData.calibration.final_loss, runData.calibration.loss_kind)}
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

        <SectionCard
          title="Stage timeline"
          description="Every stage the build reported, with how long it ran and the numbers it logged. A run that stops mid-list without a failed event ended without reporting a failure; the last row shows where."
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
                    const nextTime = next && typeof next.time === "string" ? next.time : null;
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
                          failed ? "row-neg" : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span className={failed ? "font-medium tone-neg" : ""}>
                            {String(event.stage ?? "—")}
                          </span>
                          {failed && <StatusPill tone="danger">failed</StatusPill>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                          {timeLabel(time)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {index === all.length - 1 && event.stage !== "complete" && !failed
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
                              {chips.map(([key, value]) => (
                                <span
                                  key={key}
                                  className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                                >
                                  {key}={value}
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
            description="The code commit, package versions, artifact hashes, and validation results that produced this candidate."
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
                          href={`https://github.com/PolicyEngine/microcosm/commit/${String(code.git_commit ?? "")}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          {String(code.git_commit ?? "—").slice(0, 7)}
                          {code.git_dirty ? " (dirty)" : ""}
                        </a>
                      </div>
                      {Object.entries(runtime)
                        .filter(([key]) =>
                          ["python", "policyengine-us", "policyengine-core", "torch"].includes(
                            key,
                          ),
                        )
                        .map(([key, value]) => (
                          <div
                            key={key}
                            className="flex justify-between gap-2 border-b border-border/40 py-1"
                          >
                            <span className="text-muted-foreground">{key}</span>
                            <span className="font-mono text-foreground">{String(value)}</span>
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
                          Validation results
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(gates).map(([name, result]) => {
                            const validation = (result ?? {}) as Record<string, unknown>;
                            const passed = validation.passed === true;
                            const failures = Array.isArray(validation.failures)
                              ? validation.failures
                              : [];
                            return (
                              <div
                                key={name}
                                className={`rounded-md border px-2 py-1 text-xs ${
                                  passed ? "pill-pos" : "pill-neg"
                                }`}
                              >
                                <span className="font-medium">{name}</span>{" "}
                                {passed ? "passed" : "failed"}
                                {failures.length > 0 && (
                                  <span className="ml-1 font-mono text-[10px]">
                                    {failures.map((failure) => String(failure)).join("; ")}
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
            description="Files this run has published to the staging repository so far."
            padded={false}
          >
            <table className="w-full text-left text-sm">
              <tbody>
                {Object.entries(artifacts).map(([name, metadata]) => (
                  <tr key={name} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-1.5 font-medium">{name}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {metadata.staging_path ? (
                        <a
                          href={`https://huggingface.co/datasets/${runData.source_repo}/blob/main/${metadata.staging_path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted underline-offset-2 hover:text-primary"
                        >
                          {metadata.staging_path}
                        </a>
                      ) : (
                        (metadata.path ?? "—")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}
      </div>
    </details>
  );
}

function ReformValidationTable({ rows }: { rows: ReformValidationRow[] }) {
  const ordered = [...rows]
    .filter((row) => row.microcosm_estimate != null || row.jct_score != null)
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
            <th className="px-3 py-2 text-right font-semibold">Error</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => {
            return (
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
                  {fmtUnitValue(row.jct_score, row.unit)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {fmtUnitValue(row.microcosm_estimate, row.unit)}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                    validationTone(row.abs_relative_error) === "positive"
                      ? "tone-pos"
                      : validationTone(row.abs_relative_error) === "negative"
                        ? "tone-neg"
                        : "text-foreground"
                  }`}
                >
                  {pct(row.abs_relative_error)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Common-target fit stats for the candidate-vs-current-release verdict: computed on
// the SAME targets, since headline within-10% rates over different target sets
// (32k national-only vs 4k) are not comparable.
interface SideStats {
  n: number;
  within10: number;
  median: number | null;
  mean: number | null;
}

const VALIDATION_METHOD_HELP = {
  targetWithin10:
    "Measures the share of targets present in both releases whose absolute relative error is at most 10% of the benchmark value; higher is better. This metric is restricted to shared targets to ensure direct comparability.",
  targetMedianAbsoluteError:
    "Calculates the median absolute relative error across targets present in both releases. Lower is better.",
  targetMeanAbsoluteError:
    "Calculates the mean absolute relative error across targets present in both releases. Lower is better.",
  reformMeanAbsoluteError:
    "Calculates the mean absolute relative error between the candidate's estimated reform effects and the external benchmarks for out-of-sample reforms. Out-of-sample means that the reform includes values that are not used as calibration targets; lower is better.",
  reformWithin10:
    "Measures the share of scored out-of-sample reforms whose estimated effect is within 10% of the external benchmark. Out-of-sample means that the reform includes values that are not used as calibration targets; higher is better.",
  targetCoverage:
    "Counts the complete set of calibration targets available in each release, including targets that are not shared. The verdict reports how many targets the candidate adds and removes relative to the current release.",
} as const;

function sideStats(errors: number[]): SideStats {
  if (!errors.length) return { n: 0, within10: 0, median: null, mean: null };
  const sorted = [...errors].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    n: errors.length,
    within10: errors.filter((e) => e <= 0.1).length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    mean: errors.reduce((s, e) => s + e, 0) / errors.length,
  };
}

// One row of the validation scorecard: a metric on both sides plus a verdict.
function ScoreRow({
  label,
  about,
  currentRelease,
  candidate,
  higherBetter,
  render = pct,
}: {
  label: string;
  about: string;
  currentRelease: number | null;
  candidate: number | null;
  higherBetter: boolean;
  render?: (v: number | null | undefined) => string;
}) {
  const better =
    currentRelease != null && candidate != null
      ? higherBetter
        ? candidate > currentRelease + 1e-6
        : candidate < currentRelease - 1e-6
      : null;
  const worse =
    currentRelease != null && candidate != null
      ? higherBetter
        ? candidate < currentRelease - 1e-6
        : candidate > currentRelease + 1e-6
      : null;
  return (
    <tr className="col-span-full grid grid-cols-subgrid border-b border-border/60 last:border-b-0">
      <td className="whitespace-nowrap py-1.5 font-medium">{label}</td>
      <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground">
        {render(currentRelease)}
      </td>
      <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums">
        {render(candidate)}
      </td>
      <td
        className={`whitespace-nowrap py-1.5 text-right text-xs font-semibold ${
          better ? "tone-pos" : worse ? "tone-neg" : "text-muted-foreground"
        }`}
      >
        {better ? "candidate better" : worse ? "candidate worse" : currentRelease == null || candidate == null ? "—" : "tie"}
      </td>
      <td className="whitespace-nowrap py-1.5 text-center">
        <HelpHint
          label={<span className="sr-only">About {label}</span>}
          tooltip={about}
          interaction="click"
          underline={false}
        />
      </td>
    </tr>
  );
}

export function MicrocosmStagingView() {
  const { country } = useCountry();

  if (!hasCapability(country, "staging")) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader eyebrow="Microcosm · staging" title="Staging candidates" />
        <EmptyState
          title="Staging unavailable"
          description={`${countryRegistration(country).label} has no staging repository.`}
        />
      </div>
    );
  }

  return <MicrocosmStagingRunsView />;
}

function MicrocosmStagingRunsView() {
  const { data: runsData, isLoading: runsLoading, error: runsError } = useMicrocosmStagingRuns();
  const runs = runsData?.runs ?? [];
  const [selectedRun, setSelectedRun] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [runInternalsOpen, setRunInternalsOpen] = useState(false);

  const resetRunVisualState = useCallback((runId: string) => {
    setTargetSearch("");
    setRunInternalsOpen(false);
    setSelectedRun(runId);
  }, []);

  useEffect(() => {
    if (!selectedRun && runs[0]) resetRunVisualState(runs[0].run_id);
  }, [resetRunVisualState, runs, selectedRun]);

  const { data: runData, isLoading: runLoading, error: runError } =
    useMicrocosmStagingRun(selectedRun);
  const {
    data: compareData,
    isLoading: compareLoading,
    error: compareError,
  } = useMicrocosmStagingCompare(
    runData?.has_calibration ? selectedRun : undefined,
    "latest",
  );
  // Fit stats on the targets both sides share — the honest better-or-worse basis.
  const commonStats = useMemo(() => {
    const rows = compareData?.rows ?? [];
    const a: number[] = [];
    const b: number[] = [];
    for (const row of rows) {
      const ae = row.a_relative_error;
      const be = row.b_relative_error;
      if (ae == null || be == null) continue;
      // Drop tiny-denominator artifacts, same convention as the highlights.
      if (Math.abs(ae) > 10 || Math.abs(be) > 10) continue;
      a.push(Math.abs(ae));
      b.push(Math.abs(be));
    }
    return { a: sideStats(a), b: sideStats(b) };
  }, [compareData]);
  const calibrationEvents = runData?.calibration_progress?.events ?? [];
  const lossValues = useMemo(
    () =>
      calibrationEvents
        .map((event) => (typeof event.loss === "number" ? event.loss : null))
        .filter((value): value is number => value != null),
    [calibrationEvents],
  );
  const progress = runData?.progress ?? {};
  const rawStatus = typeof progress.status === "string" ? progress.status : null;
  const stage = typeof progress.stage === "string" ? progress.stage : null;
  const updatedAt = typeof progress.updated_at === "string" ? progress.updated_at : null;
  const status = effectiveStatus(rawStatus, updatedAt);
  const statusLabel = formatStagingStatus(status);
  const lastUpdate = `${timeLabel(updatedAt)}${agoLabel(updatedAt) ? ` · ${agoLabel(updatedAt)}` : ""}`;
  const currentStatus = formatStagingCurrentStatus(progress);
  const candidateReleaseId = runData?.candidate_release_id ?? selectedRun;
  const buildManifest = (runData?.build_manifest ?? null) as Record<string, unknown> | null;
  const artifacts = ((runData?.run_manifest as Record<string, unknown> | null)?.artifacts ??
    {}) as Record<string, { path?: string; staging_path?: string }>;
  const hasCandidateValidation = Boolean(compareData?.summary || runData?.reform_validation);
  const targetComparisonPending = Boolean(
    runData?.has_calibration && compareLoading && !compareData,
  );
  const candidateValidationPending = targetComparisonPending && !hasCandidateValidation;
  const showsCandidateValidation = hasCandidateValidation || candidateValidationPending;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Microcosm · staging"
        title="Staging candidates"
        description="Monitor Microcosm build candidates before they are promoted to the published Hugging Face release channel."
      />

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <SectionCard title="Runs">
          {runsLoading ? (
            <LoadingBlock label="Loading staging runs…" height="h-40" />
          ) : runsError ? (
            <EmptyState
              title="Staging runs unavailable"
              description={runsError instanceof Error ? runsError.message : "Unknown error."}
              variant="compact"
            />
          ) : runsData && runsData.available === false ? (
            <EmptyState
              title="Staging repo not reachable"
              description={runsData.detail || "The staging repo could not be read."}
              variant="compact"
            />
          ) : (
            <RunList
              runs={runs}
              selected={selectedRun}
              onSelect={resetRunVisualState}
            />
          )}
        </SectionCard>

        {!selectedRun ? (
            <div className="lg:col-start-2">
              <EmptyState title="Select a staging run." />
            </div>
          ) : runLoading ? (
            <div className="lg:col-start-2">
              <LoadingBlock label="Loading staging run…" />
            </div>
          ) : runError || !runData ? (
            <div className="lg:col-start-2">
              <EmptyState
                title="Staging run unavailable"
                description={runError instanceof Error ? runError.message : "Unknown error."}
              />
            </div>
          ) : (
            <>
              <div className="flex min-w-0 flex-col gap-5 lg:col-start-2">
              <SectionCard
                title="Candidate overview"
                className="w-full"
                padded={false}
              >
                <div className="grid grid-cols-[min-content_minmax(0,1fr)] items-baseline gap-y-3 py-3.5">
                  <div
                    className={`whitespace-nowrap px-5 text-primary ${overviewMetricLabelTypographyClassName}`}
                  >
                    Candidate
                  </div>
                  <div
                    className={`min-w-0 truncate text-xs ${overviewMetricValueClassName}`}
                    title={candidateReleaseId}
                  >
                    {candidateReleaseId}
                  </div>
                  <div
                    className={`whitespace-nowrap px-5 text-primary ${overviewMetricLabelTypographyClassName}`}
                  >
                    Status
                  </div>
                  <div
                    className={`min-w-0 truncate text-xs ${overviewMetricValueClassName}`}
                    title={statusLabel}
                  >
                    {statusLabel}
                  </div>
                  <div
                    className={`whitespace-nowrap px-5 text-primary ${overviewMetricLabelTypographyClassName}`}
                  >
                    Last update
                  </div>
                  <div
                    className={`min-w-0 truncate text-xs ${overviewMetricValueClassName}`}
                    title={lastUpdate}
                  >
                    {lastUpdate}
                  </div>
                  <div
                    className={`whitespace-nowrap px-5 text-primary ${overviewMetricLabelTypographyClassName}`}
                  >
                    Current status
                  </div>
                  <div
                    className={`min-w-0 truncate text-xs ${overviewMetricValueClassName}`}
                    title={currentStatus}
                  >
                    {currentStatus}
                  </div>
                </div>
              </SectionCard>

              {candidateValidationPending && (
                <SectionCard
                  title="Candidate validation"
                >
                  <LoadingBlock
                    label="Comparing candidate vs current release (loads both calibration packages)…"
                    height="h-24"
                  />
                </SectionCard>
              )}

              {hasCandidateValidation && (
                <SectionCard
                  title="Candidate validation"
                  padded={false}
                >
                  <div className="overflow-x-auto px-5">
                    <table className="grid w-full grid-cols-[max-content_max-content_max-content_max-content_max-content] justify-between gap-x-2 text-left text-xs">
                    <thead className="col-span-full grid grid-cols-subgrid">
                      <tr className="col-span-full grid grid-cols-subgrid border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="whitespace-nowrap py-2 font-semibold">Validation point</th>
                        <th className="whitespace-nowrap py-2 text-right font-semibold">Current release</th>
                        <th className="whitespace-nowrap py-2 text-right font-semibold">Candidate</th>
                        <th className="whitespace-nowrap py-2 text-right font-semibold">Verdict</th>
                        <th className="whitespace-nowrap py-2 text-center font-semibold">About</th>
                      </tr>
                    </thead>
                    <tbody className="col-span-full grid grid-cols-subgrid">
                      {targetComparisonPending && (
                        <tr className="col-span-full grid grid-cols-subgrid border-b border-border/60">
                          <td
                            colSpan={5}
                            className="col-span-full py-3 text-muted-foreground"
                          >
                            Loading target comparison…
                          </td>
                        </tr>
                      )}
                      {compareData?.summary && (
                        <>
                          <ScoreRow
                            label="Targets within 10% of benchmark (shared)"
                            about={VALIDATION_METHOD_HELP.targetWithin10}
                            currentRelease={commonStats.a.n ? commonStats.a.within10 / commonStats.a.n : null}
                            candidate={commonStats.b.n ? commonStats.b.within10 / commonStats.b.n : null}
                            higherBetter
                          />
                          <ScoreRow
                            label="Target median absolute error (shared)"
                            about={VALIDATION_METHOD_HELP.targetMedianAbsoluteError}
                            currentRelease={commonStats.a.median}
                            candidate={commonStats.b.median}
                            higherBetter={false}
                          />
                          <ScoreRow
                            label="Target mean absolute error (shared)"
                            about={VALIDATION_METHOD_HELP.targetMeanAbsoluteError}
                            currentRelease={commonStats.a.mean}
                            candidate={commonStats.b.mean}
                            higherBetter={false}
                          />
                        </>
                      )}
                      {runData.reform_validation && (
                        <>
                          <ScoreRow
                            label="Reform out-of-sample mean absolute error"
                            about={VALIDATION_METHOD_HELP.reformMeanAbsoluteError}
                            currentRelease={null}
                            candidate={
                              runData.reform_validation.summary
                                ?.out_of_sample_mean_abs_relative_error ?? null
                            }
                            higherBetter={false}
                          />
                          <ScoreRow
                            label="Reform out-of-sample within 10% of benchmark"
                            about={VALIDATION_METHOD_HELP.reformWithin10}
                            currentRelease={null}
                            candidate={
                              (runData.reform_validation.summary?.n_out_of_sample_scored ?? 0) > 0
                                ? (runData.reform_validation.summary?.out_of_sample_within_10pct ??
                                    0) /
                                  (runData.reform_validation.summary?.n_out_of_sample_scored ?? 1)
                                : null
                            }
                            higherBetter
                          />
                        </>
                      )}
                      {compareData?.summary && (
                        <tr className="col-span-full grid grid-cols-subgrid border-b border-border/60 last:border-b-0">
                          <td className="whitespace-nowrap py-1.5 font-medium">Coverage target surface</td>
                          <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground">
                            {fmt(compareData.a.total_targets, { digits: 0 })}
                          </td>
                          <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums">
                            {fmt(compareData.b.total_targets, { digits: 0 })}
                          </td>
                          <td className="whitespace-nowrap py-1.5 text-right text-xs text-muted-foreground">
                            +{fmt(compareData.summary.added, { digits: 0 })} new / -
                            {fmt(compareData.summary.removed, { digits: 0 })} dropped
                          </td>
                          <td className="whitespace-nowrap py-1.5 text-center">
                            <HelpHint
                              label={<span className="sr-only">About Coverage target surface</span>}
                              tooltip={VALIDATION_METHOD_HELP.targetCoverage}
                              interaction="click"
                              underline={false}
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                    </table>
                  </div>
                  {compareData?.summary && (
                    <div className="border-t border-border/60 px-5 py-2 text-xs text-muted-foreground">
                      <div>
                        <span className="tone-pos">
                          {fmt(compareData.summary.improved, { digits: 0 })} targets improved
                        </span>
                        {" · "}
                        <span className="tone-neg">
                          {fmt(compareData.summary.regressed, { digits: 0 })} regressed
                        </span>
                      </div>
                    </div>
                  )}
                </SectionCard>
              )}

              {!showsCandidateValidation && (
                <RunInternalsPanel
                  runData={runData}
                  lossValues={lossValues}
                  status={status}
                  stage={stage}
                  buildManifest={buildManifest}
                  artifacts={artifacts}
                  open={runInternalsOpen}
                  onOpenChange={setRunInternalsOpen}
                />
              )}
              </div>

              <div className="contents">
                {runData.has_calibration && (
                  <SectionCard
                    title="Target error change"
                    className="lg:col-span-2 lg:col-start-1"
                    description="Shows which parts of the target surface account for the candidate's increase or reduction in weighted target error."
                  >
                    {compareData?.summary ? (
                      <StagingTargetChangeMap
                        key={targetChangeMapIdentity(selectedRun, compareData.a.release_id)}
                        runId={selectedRun}
                        releaseId={compareData.a.release_id}
                      />
                    ) : compareLoading ? (
                      <LoadingBlock
                        label="Loading calibration diagnostics for the target error comparison…"
                        height="h-40"
                      />
                    ) : (
                      <EmptyState
                        title="Target error comparison unavailable"
                        description={
                          compareError instanceof Error
                            ? compareError.message
                            : compareData?.detail ??
                              "The calibration diagnostics are available, but the comparison could not be loaded."
                        }
                        variant="compact"
                      />
                    )}
                  </SectionCard>
                )}

                {runData.has_calibration && (
                <SectionCard
                  title="Target breakdown"
                  className="lg:col-span-2 lg:col-start-1"
                  description="Every target both sides share, worst movement first. Search by statistic, variable, or geography."
                  actions={
                    compareData?.summary ? (
                      <input
                        type="search"
                        value={targetSearch}
                        placeholder="Search targets…"
                        onChange={(e) => setTargetSearch(e.target.value)}
                        className="h-8 w-56 rounded-md border border-border bg-card px-2.5 text-sm focus:border-primary/60 focus:outline-none"
                      />
                    ) : undefined
                  }
                  padded={false}
                >
                  {compareData?.summary ? (() => {
                    const q = targetSearch.trim().toLowerCase();
                    const usable = (compareData?.rows ?? []).filter(
                      (row) =>
                        // Drop tiny-denominator artifacts (>1000% errors),
                        // same convention as the release highlights.
                        Math.abs(row.b_relative_error ?? 0) <= 10 &&
                        Math.abs(row.a_relative_error ?? 0) <= 10,
                    );
                    const matched = q
                      ? usable.filter((row) =>
                          [row.name, row.variable, row.target_label, row.geography, row.source]
                            .filter(Boolean)
                            .some((v) => String(v).toLowerCase().includes(q)),
                        )
                      : usable;
                    const shown = [...matched]
                      .sort(
                        (x, y) =>
                          Math.abs(y.abs_rel_delta ?? 0) - Math.abs(x.abs_rel_delta ?? 0),
                      )
                      .slice(0, 50);
                    const pctOrDash = (v: number | null | undefined) =>
                      v == null ? "—" : fmt(Math.abs(v), { pct: true, digits: 1 });
                    if (!shown.length) {
                      return (
                        <EmptyState
                          title={q ? `No targets match “${targetSearch}”.` : "No comparable targets."}
                          variant="compact"
                        />
                      );
                    }
                    return (
                      <>
                        <div className="max-h-96 overflow-y-auto">
                          <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-card shadow-[var(--elev-1)]">
                              <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                <th className="px-3 py-2 font-semibold">Target</th>
                                <th className="px-3 py-2 text-right font-semibold">Current release</th>
                                <th className="px-3 py-2 text-right font-semibold">Candidate</th>
                                <th className="px-3 py-2 text-right font-semibold">Δ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shown.map((row) => {
                                const delta = row.abs_rel_delta ?? null;
                                return (
                                  <tr
                                    key={row.name}
                                    className="border-b border-border/60 last:border-b-0"
                                  >
                                    <td className="px-3 py-1.5">
                                      <span className="font-medium text-foreground">
                                        {row.variable ?? row.name}
                                      </span>
                                      {row.target_label ? (
                                        <span className="text-xs text-muted-foreground">
                                          {" "}
                                          · {row.target_label}
                                        </span>
                                      ) : null}
                                      {row.geography ? (
                                        <span className="text-xs text-muted-foreground">
                                          {" "}
                                          · {row.geography}
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                      {pctOrDash(row.a_relative_error)}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                                      {pctOrDash(row.b_relative_error)}
                                    </td>
                                    <td
                                      className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${
                                        delta == null
                                          ? "text-muted-foreground"
                                          : delta > 1e-9
                                            ? "tone-neg"
                                            : delta < -1e-9
                                              ? "tone-pos"
                                              : "text-muted-foreground"
                                      }`}
                                    >
                                      {delta == null
                                        ? "—"
                                        : `${delta > 0 ? "+" : ""}${fmt(delta, { pct: true, digits: 1 })}`}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                          Showing {fmt(shown.length, { digits: 0 })} of{" "}
                          {fmt(matched.length, { digits: 0 })}
                          {q ? " matching" : ""} targets, biggest |Δ| first.
                        </div>
                      </>
                    );
                  })() : compareLoading ? (
                    <LoadingBlock
                      label="Loading calibration diagnostics for the target breakdown…"
                      height="h-40"
                    />
                  ) : (
                    <EmptyState
                      title="Target breakdown unavailable"
                      description={
                        compareError instanceof Error
                          ? compareError.message
                          : compareData?.detail ??
                            "The calibration diagnostics are available, but the target breakdown could not be loaded."
                      }
                      variant="compact"
                    />
                  )}
                </SectionCard>
              )}

              {runData.reform_validation && (
                <SectionCard
                  title="External checks breakdown"
                  className="lg:col-span-2 lg:col-start-1"
                  description="Each score test the run uploaded. Out-of-sample rows are the main signal; in-sample rows were direct or near-direct calibration targets. Cross-release external comparisons live in the PolicyEngine scorecard."
                  padded={false}
                >
                  <ReformValidationTable rows={runData.reform_validation.rows ?? []} />
                </SectionCard>
              )}

              {showsCandidateValidation && (
                <RunInternalsPanel
                  runData={runData}
                  lossValues={lossValues}
                  status={status}
                  stage={stage}
                  buildManifest={buildManifest}
                  artifacts={artifacts}
                  open={runInternalsOpen}
                  onOpenChange={setRunInternalsOpen}
                  className="lg:col-span-2 lg:col-start-1"
                />
              )}
              </div>
            </>
          )}
      </div>
    </div>
  );
}
