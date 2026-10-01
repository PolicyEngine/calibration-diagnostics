"use client";

import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { HelpHint } from "@/components/shared/help-hint";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import { useBuildRun, useBuildRuns } from "@/lib/api/hooks/use-microcosm";
import {
  BUILD_GATE_CATALOG_SOURCE,
  GATE_POSITIONS,
  type CatalogGate,
} from "@/lib/microcosm/build-gate-catalog";
import {
  BUILD_PHASES,
  type BuildForecast,
  type BuildPhase,
  type BuildRunSource,
  type BuildRunState,
  type BuildTimeline,
  type FailureClassStat,
  type GateStat,
  type PhaseTotals,
  type StageForecast,
  type StageStat,
  formatStageName,
  runDurationMs,
  stageCores,
  stageMemoryBytes,
  type StageSpan,
} from "@/lib/microcosm/build-monitor";

const PHASE_COLOR: Record<BuildPhase, string> = {
  setup: "var(--chart-4)",
  checks: "var(--chart-2)",
  compile: "var(--chart-1)",
  calibrate: "var(--chart-3)",
  export: "var(--chart-5)",
};
const FAILED_COLOR = "var(--destructive)";
const PENDING_FILL =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--border-strong) 55%, transparent) 0 4px, transparent 4px 8px)";

const STATE_LABEL: Record<BuildRunState, string> = {
  running: "Running",
  passed: "Finished",
  blocked: "Blocked by gates",
  failed: "Failed",
  stalled: "Stalled",
};
const STATE_TONE: Record<BuildRunState, StatusTone> = {
  running: "info",
  passed: "success",
  blocked: "warning",
  failed: "danger",
  stalled: "warning",
};
const STATE_SWATCH: Record<BuildRunState, string> = {
  running: "swatch-info",
  passed: "swatch-pos",
  blocked: "swatch-warn",
  failed: "swatch-neg",
  stalled: "swatch-warn",
};

const FAILURE_CLASS_LABEL: Record<string, string> = {
  gate_refused: "Gate refused",
  terminated: "Terminated (SIGTERM)",
  interrupted: "Interrupted",
  out_of_memory: "Out of memory",
  refused: "Refused before building",
  error: "Error",
  stopped_without_final_event: "Stopped without a final event (killed)",
  abandoned_early: "Stopped within 2 min of starting (test or abort)",
  unclassified: "Failed, no class recorded",
};

function failureClassLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return FAILURE_CLASS_LABEL[value] ?? formatStageName(value);
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const gb = bytes / 1e9;
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

function plural(unit: string): string {
  return /(s|x|ch|sh)$/.test(unit) ? `${unit}es` : `${unit}s`;
}

function fmtCores(cores: number | null | undefined): string {
  if (cores == null || !Number.isFinite(cores)) return "—";
  return cores >= 10 ? cores.toFixed(0) : cores.toFixed(1);
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return `${Math.round(hours / 24)} days`;
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function fmtClock(ms: number | null | undefined, nowMs: number): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const date = new Date(ms);
  const sameDay = new Date(nowMs).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function runOptionLabel(run: BuildTimeline): string {
  const started = run.started_ms
    ? new Date(run.started_ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "unknown start";
  return `${STATE_LABEL[run.state]} · ${run.pipeline_label} · ${started} · ${run.run_id}`;
}

function SourceToggle({
  source,
  localEnabled,
  onChange,
}: {
  source: BuildRunSource;
  localEnabled: boolean;
  onChange: (source: BuildRunSource) => void;
}) {
  const options: { id: BuildRunSource; label: string; hint: string }[] = [
    {
      id: "local",
      label: "Local runs",
      hint: localEnabled
        ? "Run folders on this machine"
        : "Set MICROCOSM_LOCAL_RUNS_DIR and restart the dashboard",
    },
    { id: "staging", label: "Staging repository", hint: "Runs uploaded to Hugging Face staging" },
  ];
  return (
    <div role="radiogroup" aria-label="Run source" className="inline-flex rounded-md border border-border p-0.5">
      {options.map((option) => {
        const active = option.id === source;
        const disabled = option.id === "local" && !localEnabled;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            disabled={disabled}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={`h-8 rounded px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// The Build progress tab of the Staging candidates page. `preferredRunId`
// carries the run selected on the Candidate tab; a run picked here is
// reported back through `onRunChange` so the other tab opens on it.
export function BuildMonitorView({
  tabs,
  preferredRunId,
  onRunChange,
}: {
  tabs?: ReactNode;
  preferredRunId?: string;
  onRunChange?: (runId: string) => void;
}) {
  const [chosenSource, setChosenSource] = useState<BuildRunSource | null>(null);
  // The local listing answers instantly and says whether local runs are on;
  // the staging repository is read only once it is the chosen source.
  const local = useBuildRuns("local");
  const localEnabled = local.data?.local_enabled ?? false;
  const localRuns = local.data?.runs ?? [];
  // Open local runs when this machine has them, unless the run carried over
  // from the Candidate tab exists only in the staging repository.
  const preferLocal =
    localEnabled &&
    (!preferredRunId || localRuns.some((run) => run.run_id === preferredRunId));
  const source: BuildRunSource = chosenSource ?? (preferLocal ? "local" : "staging");
  const staging = useBuildRuns("staging", source === "staging" && !local.isLoading);
  const list = source === "local" ? local : staging;
  const runs = list.data?.runs ?? [];
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!runs.length) return;
    if (!runs.some((run) => run.run_id === selected)) {
      const preferred = runs.find((run) => run.run_id === preferredRunId);
      const running = runs.find((run) => run.state === "running");
      // Otherwise the newest run that got going: one that went silent within
      // two minutes of starting (a test or an abort) shows almost nothing.
      const substantial = runs.find((run) => {
        const duration = runDurationMs(run, Date.now());
        return duration != null && duration >= 2 * 60_000;
      });
      setSelected((preferred ?? running ?? substantial ?? runs[0]).run_id);
    }
  }, [runs, selected, preferredRunId]);

  const selectRun = (runId: string) => {
    setSelected(runId);
    onRunChange?.(runId);
  };

  const detail = useBuildRun(source, selected || undefined);
  const data = detail.data;
  const nowMs = data?.now_ms ?? Date.now();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Microcosm · staging"
        title="Staging candidates"
        status={tabs}
        description="Follow a build while it runs, see when it should finish, and find where build time goes and which checks fail late."
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SourceToggle
              source={source}
              localEnabled={localEnabled}
              onChange={(next) => {
                setChosenSource(next);
                setSelected("");
              }}
            />
            <ToolbarSelect
              label="Run"
              value={selected}
              options={
                runs.length
                  ? runs.map((run) => ({ value: run.run_id, label: runOptionLabel(run) }))
                  : [{ value: "", label: list.isLoading ? "Loading runs…" : "No runs" }]
              }
              onChange={selectRun}
              disabled={!runs.length}
              className="w-[30rem] max-w-full"
            />
          </div>
        }
      />

      {(list.isLoading || local.isLoading) && !runs.length ? (
        <LoadingBlock label="Loading build runs…" />
      ) : list.error ? (
        <EmptyState title="Build runs unavailable" description={String(list.error.message)} />
      ) : list.data && !list.data.available ? (
        <EmptyState
          title={source === "local" ? "Local runs are off" : "Staging runs unavailable"}
          description={list.data.detail ?? undefined}
        />
      ) : !runs.length ? (
        <EmptyState
          title="No build runs found"
          description={
            source === "local"
              ? `No run folders (progress.json and events.ndjson) under ${list.data?.roots.join(", ") || "the configured directory"}.`
              : "The staging repository has no runs for this country."
          }
        />
      ) : detail.isLoading && !data ? (
        <LoadingBlock label="Loading run…" />
      ) : detail.error ? (
        <EmptyState title="Run unavailable" description={String(detail.error.message)} />
      ) : data ? (
        <>
          <RunOverview run={data.run} forecast={data.forecast} nowMs={nowMs} />
          <TimelineCard run={data.run} forecast={data.forecast} nowMs={nowMs} />
          <TimeBudgetCard
            pipelineLabel={data.run.pipeline_label}
            pipelineRuns={data.pipeline_runs}
            stats={data.stage_stats}
            totals={data.phase_totals}
            selected={data.run.run_id}
          />
          <GatesCard
            stats={data.gate_stats}
            failureClasses={data.failure_classes ?? []}
            catalog={data.gate_catalog}
            pipelineRuns={data.pipeline_runs}
          />
          {list.data?.problems.length ? (
            <SectionCard
              title="Runs that could not be read"
              description="Their telemetry does not match the staging contract."
            >
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {list.data.problems.map((problem) => (
                  <li key={problem.run_id}>
                    <span className="font-mono text-foreground">{problem.run_id}</span>: {problem.detail}
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RunOverview({
  run,
  forecast,
  nowMs,
}: {
  run: BuildTimeline;
  forecast: BuildForecast | null;
  nowMs: number;
}) {
  const running = run.state === "running";
  const elapsed = runDurationMs(run, nowMs);
  const fraction = forecast?.fraction_complete ?? (run.state === "passed" ? 1 : null);
  const silentFor = run.updated_ms != null ? nowMs - run.updated_ms : null;
  const pace = forecast?.pace ?? null;
  return (
    <SectionCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATE_TONE[run.state]}>{STATE_LABEL[run.state]}</StatusPill>
          <span>{run.pipeline_label}</span>
          <span className="font-mono text-xs font-normal text-muted-foreground">{run.run_id}</span>
        </span>
      }
      description={[
        `Started ${fmtClock(run.started_ms, nowMs)}`,
        running || run.state === "stalled" ? `last telemetry ${fmtDuration(silentFor)} ago` : null,
        run.heartbeat_ms != null && (running || run.state === "stalled")
          ? `heartbeat ${fmtDuration(nowMs - run.heartbeat_ms)} ago`
          : null,
        run.source === "local" ? "local run folder" : "staging repository",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Elapsed" value={fmtDuration(elapsed)} size="sm" />
          {running ? (
            <KpiCard
              label="Expected finish"
              value={forecast?.finish_p50_ms ? fmtClock(forecast.finish_p50_ms, nowMs) : "Unknown"}
              hint={
                forecast?.finish_p90_ms
                  ? `90% by ${fmtClock(forecast.finish_p90_ms, nowMs)}`
                  : "No comparable finished runs"
              }
              size="sm"
            />
          ) : (
            <KpiCard
              label={run.state === "stalled" ? "Last telemetry" : "Finished"}
              value={fmtClock(run.ended_ms ?? run.updated_ms, nowMs)}
              size="sm"
            />
          )}
          <KpiCard
            label={running ? "Remaining" : "Outcome"}
            value={
              running
                ? forecast?.remaining_p50_ms != null
                  ? fmtDuration(forecast.remaining_p50_ms)
                  : "Unknown"
                : STATE_LABEL[run.state]
            }
            hint={
              running && forecast?.remaining_p90_ms != null
                ? `Up to ${fmtDuration(forecast.remaining_p90_ms)} (90%)`
                : run.failure?.stage
                  ? `Failed in ${formatStageName(run.failure.stage)}`
                  : undefined
            }
            size="sm"
          />
          <KpiCard
            label={running ? "Current stage" : "Pace"}
            value={
              running
                ? formatStageName(forecast?.current_stage ?? run.current_stage ?? "—")
                : pace != null
                  ? `${pace.toFixed(2)}×`
                  : "—"
            }
            hint={
              running && forecast?.current_stage_elapsed_ms != null
                ? `${fmtDuration(forecast.current_stage_elapsed_ms)} in${
                    forecast.current_stage_typical_ms != null
                      ? `, typically ${fmtDuration(forecast.current_stage_typical_ms)}`
                      : ""
                  }${
                    forecast.stage_work
                      ? ` · ${forecast.stage_work.done} of ${forecast.stage_work.total} done`
                      : ""
                  }${
                    forecast.calibration
                      ? ` · epoch ${forecast.calibration.epoch} of ${forecast.calibration.epochs}${
                          forecast.calibration.pass > 0 ? `, pass ${forecast.calibration.pass + 1}` : ""
                        } at ${forecast.calibration.seconds_per_epoch.toFixed(2)} s/epoch`
                      : ""
                  }`
                : !running && pace != null
                  ? "Stage time against comparable runs"
                  : undefined
            }
            delta={forecast?.overrunning ? "Overrunning" : undefined}
            tone={forecast?.overrunning ? "negative" : "neutral"}
            size="sm"
          />
        </div>

        {running && fraction != null ? (
          <div className="flex flex-col gap-1.5">
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fraction * 100)}
              aria-label="Estimated progress"
            >
              <div className="h-full rounded-full swatch-pos transition-all" style={{ width: `${fraction * 100}%` }} />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>About {Math.round(fraction * 100)}% done</span>
              <span>
                {pace != null
                  ? `Running ${pace >= 1 ? `${pace.toFixed(2)}× slower` : `${(1 / pace).toFixed(2)}× faster`} than comparable runs · `
                  : ""}
                {forecast?.basis_runs.length
                  ? `Forecast from ${forecast.basis_runs.length} comparable run${forecast.basis_runs.length === 1 ? "" : "s"}`
                  : "No comparable runs"}
              </span>
            </div>
          </div>
        ) : null}

        <ResourceLine run={run} />

        {run.delivery?.uploads === "local_only" ? (
          <div className="rounded-md border px-3 py-2 text-xs pill-warn">
            This run did not reach the staging repository
            {run.delivery.reason ? ` (${run.delivery.reason})` : ""}, so only this machine can see it.
            {run.schema_version === 1 ? (
              <>
                {" "}Upload it from any machine with a staging token:{" "}
                <code className="font-mono">
                  uv run python tools/restage_us_staging_run.py --run-dir &lt;run folder&gt;
                </code>
              </>
            ) : null}
          </div>
        ) : null}

        {forecast?.note && running ? (
          <p className="text-xs text-muted-foreground">{forecast.note}</p>
        ) : null}

        {running && !forecast?.stage_work && !forecast?.calibration && silentFor != null && silentFor > 15 * 60_000 ? (
          <p className="text-xs text-muted-foreground">
            {formatStageName(forecast?.current_stage ?? run.current_stage ?? "This stage")} has sent no telemetry for{" "}
            {fmtDuration(silentFor)}. It reports no progress while it works, so a slow stage and a dead process look the
            same until it overruns.
          </p>
        ) : null}

        {run.state === "stalled" ? (
          <div className="rounded-md border px-3 py-2 text-sm pill-warn">
            {elapsed != null && elapsed < 2 * 60_000
              ? `This run went silent ${fmtDuration(elapsed)} after it started, most likely a test or an aborted launch.`
              : `No telemetry for ${fmtDuration(silentFor)}. A build killed by the operating system (out of memory) or interrupted never writes a final event, so this run is probably dead. Check the build machine.`}
          </div>
        ) : null}

        {run.state === "passed" && run.spans.some((span) => span.status === "failed") ? (
          <div className="rounded-md border px-3 py-2 text-sm pill-warn">
            The run finished, but{" "}
            {run.spans
              .filter((span) => span.status === "failed")
              .map((span) => formatStageName(span.stage))
              .join(", ")}{" "}
            failed along the way.
            <FailureLines run={run} />
          </div>
        ) : null}

        {run.failure ? (
          <div className="rounded-md border px-3 py-2 text-sm pill-neg">
            <div className="font-medium">
              {failureClassLabel(run.failure.failure_class) ? (
                <span className="mr-2 rounded border border-current px-1.5 py-0.5 text-[11px]">
                  {failureClassLabel(run.failure.failure_class)}
                </span>
              ) : null}
              Failed{run.failure.stage ? ` in ${formatStageName(run.failure.stage)}` : ""}
              {run.failure.error_type ? ` (${run.failure.error_type})` : ""}
              {run.started_ms != null && run.ended_ms != null
                ? ` after ${fmtDuration(run.ended_ms - run.started_ms)}`
                : ""}
            </div>
            {run.failure.message ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs">{run.failure.message}</p>
            ) : null}
            <FailureLines run={run} />
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

// What the machine is doing: cores the current (or last) stage keeps busy,
// memory now against the machine's, and what produced the run. Shown only
// when the run reports resources.
function ResourceLine({ run }: { run: BuildTimeline }) {
  const topSpans = run.spans.filter((span) => span.depth === 0);
  const current = topSpans.find((span) => span.end_ms == null) ?? topSpans[topSpans.length - 1];
  const cores = current ? stageCores(current) : null;
  const host = run.identity;
  if (!run.resources && !host) return null;
  const parts = [
    cores != null && current
      ? `${fmtCores(cores)}${host?.cpu_count ? ` of ${host.cpu_count}` : ""} cores busy in ${formatStageName(current.stage)}`
      : null,
    run.resources?.rss_bytes != null
      ? `memory ${fmtBytes(run.resources.rss_bytes)}${host?.memory_bytes ? ` of ${fmtBytes(host.memory_bytes)}` : ""}`
      : null,
    run.resources?.peak_rss_bytes != null ? `peak ${fmtBytes(run.resources.peak_rss_bytes)}` : null,
    host?.git_commit ? `commit ${host.git_commit.slice(0, 8)}` : null,
    host?.runtime["policyengine-us"] ? `policyengine-us ${host.runtime["policyengine-us"]}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>;
}

function FailureLines({ run }: { run: BuildTimeline }) {
  const lines = run.spans.filter((span) => span.status === "failed").flatMap((span) => span.failures);
  if (!lines.length) return null;
  return (
    <ul className="mt-2 flex max-h-48 list-disc flex-col gap-0.5 overflow-y-auto pl-5 text-xs">
      {lines.slice(0, 50).map((line, index) => (
        <li key={index} className="break-words">
          {line}
        </li>
      ))}
      {lines.length > 50 ? <li>…and {lines.length - 50} more</li> : null}
    </ul>
  );
}

function axisTicks(domainMs: number): number[] {
  const steps = [
    60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000,
    2 * 3_600_000, 4 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000,
  ];
  const day = 24 * 3_600_000;
  const step =
    steps.find((candidate) => domainMs / candidate <= 8) ??
    Math.ceil(domainMs / 8 / day) * day;
  const ticks: number[] = [];
  for (let t = 0; t <= domainMs; t += step) ticks.push(t);
  return ticks;
}

function tickLabel(ms: number): string {
  if (ms === 0) return "0";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = ms / 3_600_000;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

interface TimelineRow {
  key: string;
  stage: string;
  phase: BuildPhase;
  start: number;
  end: number;
  status: StageForecast["status"] | "failed";
  basis: StageForecast["basis"];
  span: StageSpan | null;
}

function TimelineCard({
  run,
  forecast,
  nowMs,
}: {
  run: BuildTimeline;
  forecast: BuildForecast | null;
  nowMs: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const failedStages = new Set(
    run.spans.filter((span) => span.depth === 0 && span.status === "failed").map((span) => span.start_ms),
  );
  const spanAt = new Map(
    run.spans.filter((span) => span.depth === 0).map((span) => [span.start_ms, span]),
  );
  const rows: TimelineRow[] = (forecast?.stages ?? []).map((stage, index) => ({
    span:
      stage.status === "pending" || run.started_ms == null
        ? null
        : (spanAt.get(run.started_ms + stage.start_offset_ms) ?? null),
    key: `${stage.stage}-${index}`,
    stage: stage.stage,
    phase: stage.phase,
    start: stage.start_offset_ms,
    end: Math.max(stage.end_offset_ms, stage.start_offset_ms),
    status:
      stage.status === "done" && run.started_ms != null && failedStages.has(run.started_ms + stage.start_offset_ms)
        ? "failed"
        : stage.status,
    basis: stage.basis,
  }));
  const elapsed = forecast?.elapsed_ms ?? runDurationMs(run, nowMs) ?? 0;
  const p90Offset =
    forecast?.finish_p90_ms != null && run.started_ms != null && run.state === "running"
      ? forecast.finish_p90_ms - run.started_ms
      : null;
  const p50Offset =
    forecast?.finish_p50_ms != null && run.started_ms != null && run.state === "running"
      ? forecast.finish_p50_ms - run.started_ms
      : null;
  const domain = Math.max(1, elapsed, p90Offset ?? 0, ...rows.map((row) => row.end)) * 1.02;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / domain) * 100))}%`;
  const width = (start: number, end: number) => `${Math.max(0.25, ((end - start) / domain) * 100)}%`;
  const threshold = domain * 0.01;
  const visible = showAll
    ? rows
    : rows.filter((row) => row.end - row.start >= threshold || row.status === "running" || row.status === "failed");
  const hidden = rows.length - visible.length;
  const hiddenMs = rows
    .filter((row) => !visible.includes(row))
    .reduce((sum, row) => sum + (row.end - row.start), 0);
  const ticks = axisTicks(domain);

  if (!rows.length) {
    return (
      <SectionCard title="Timeline">
        <EmptyState title="No stage events yet." variant="compact" />
      </SectionCard>
    );
  }

  const barStyle = (row: TimelineRow) => ({
    left: pct(row.start),
    width: width(row.start, row.end),
    background:
      row.status === "pending"
        ? PENDING_FILL
        : row.status === "failed"
          ? FAILED_COLOR
          : PHASE_COLOR[row.phase],
    opacity: row.status === "running" ? 0.75 : 1,
  });

  return (
    <SectionCard
      title="Timeline"
      description={
        run.state === "running"
          ? "Solid bars are stages that ran; hatched bars are what comparable runs did next, stretched to the forecast. The band marks the 90% finish range."
          : "Each stage of the run on one time axis."
      }
      actions={
        hidden || showAll ? (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {showAll ? "Hide short stages" : `Show ${hidden} short stages`}
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1">
        <PhaseLegend />
        <div className="mt-2 grid grid-cols-[minmax(8rem,14rem)_1fr] gap-x-3 gap-y-1 text-xs">
          <div className="font-medium text-muted-foreground">Whole run</div>
          <div className="relative h-6 rounded bg-muted/40">
            {rows.map((row) => (
              <div
                key={`whole-${row.key}`}
                className="absolute top-0 h-full"
                style={barStyle(row)}
                title={`${formatStageName(row.stage)}: ${fmtDuration(row.end - row.start)}`}
              />
            ))}
            {p50Offset != null && p90Offset != null ? (
              <div
                className="absolute -top-1 h-8 border-x border-dashed border-foreground/40 bg-foreground/5"
                style={{ left: pct(p50Offset), width: width(p50Offset, p90Offset) }}
                title={`Finish between ${fmtDuration(p50Offset)} and ${fmtDuration(p90Offset)} after start`}
              />
            ) : null}
            {run.state === "running" ? <NowLine left={pct(elapsed)} /> : null}
          </div>

          {visible.map((row) => (
            <TimelineStageRow
              key={row.key}
              row={row}
              barStyle={barStyle(row)}
              nowLeft={run.state === "running" ? pct(elapsed) : null}
              labelLeft={row.end / domain > 0.85}
            />
          ))}
          {hidden && !showAll ? (
            <>
              <div className="truncate text-muted-foreground">{hidden} short stages</div>
              <div className="text-muted-foreground">{fmtDuration(hiddenMs)} in total</div>
            </>
          ) : null}

          <div />
          <div className="relative mt-1 h-4 border-t border-border text-[10px] text-muted-foreground">
            {ticks.map((tick) => (
              <span key={tick} className="absolute -translate-x-1/2 pt-0.5 tabular-nums" style={{ left: pct(tick) }}>
                {tickLabel(tick)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function NowLine({ left }: { left: string }) {
  return (
    <div className="absolute -top-1 h-8 w-px bg-foreground" style={{ left }} title="Now">
      <span className="absolute -top-3 -translate-x-1/2 text-[9px] font-medium uppercase text-foreground">now</span>
    </div>
  );
}

function TimelineStageRow({
  row,
  barStyle,
  nowLeft,
  labelLeft,
}: {
  row: TimelineRow;
  barStyle: CSSProperties;
  nowLeft: string | null;
  // Bars ending near the right edge carry their label on the left.
  labelLeft: boolean;
}) {
  const label =
    row.status === "running"
      ? "running"
      : row.status === "pending"
        ? "expected"
        : row.status === "failed"
          ? "failed"
          : null;
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5" title={row.stage}>
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ background: row.status === "failed" ? FAILED_COLOR : PHASE_COLOR[row.phase] }} />
        <span className={`truncate ${row.status === "pending" ? "text-muted-foreground" : ""}`}>{formatStageName(row.stage)}</span>
      </div>
      <div className="relative h-5">
        <div
          className={`absolute top-0.5 h-4 rounded-sm ${row.status === "running" ? "animate-pulse" : ""}`}
          style={barStyle}
        />
        <span
          className={`absolute top-0.5 whitespace-nowrap text-[10px] leading-4 text-muted-foreground ${
            labelLeft ? "pr-1" : "pl-1"
          }`}
          style={
            labelLeft
              ? { right: `calc(100% - ${barStyle.left})` }
              : { left: `calc(${barStyle.left} + ${barStyle.width})` }
          }
        >
          {fmtDuration(row.end - row.start)}
          {label ? ` · ${label}` : ""}
          {row.basis === "measured_rate" ? " (measured rate)" : ""}
          {row.span && stageCores(row.span) != null ? ` · ${fmtCores(stageCores(row.span))} cores` : ""}
          {row.span && stageMemoryBytes(row.span) != null ? ` · ${fmtBytes(stageMemoryBytes(row.span))}` : ""}
          {row.span?.work ? ` · ${row.span.work.done} of ${row.span.work.total} ${plural(row.span.work.unit ?? "unit")}` : ""}
        </span>
        {nowLeft ? <div className="absolute top-0 h-5 w-px bg-foreground/30" style={{ left: nowLeft }} /> : null}
      </div>
    </>
  );
}

function PhaseLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {BUILD_PHASES.map((phase) => (
        <span key={phase.id} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLOR[phase.id] }} />
          {phase.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: FAILED_COLOR }} />
        Failed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: PENDING_FILL }} />
        Expected
      </span>
    </div>
  );
}

function TimeBudgetCard({
  pipelineLabel,
  pipelineRuns,
  stats,
  totals,
  selected,
}: {
  pipelineLabel: string;
  pipelineRuns: number;
  stats: StageStat[];
  totals: PhaseTotals[];
  selected: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const byMedian = useMemo(() => [...stats].sort((a, b) => b.median_ms - a.median_ms), [stats]);
  const shown = expanded ? byMedian : byMedian.slice(0, 10);
  const phaseShare = useMemo(() => {
    const sums = new Map<BuildPhase, number>();
    for (const stat of stats) sums.set(stat.phase, (sums.get(stat.phase) ?? 0) + stat.median_ms);
    const total = [...sums.values()].reduce((a, b) => a + b, 0);
    return BUILD_PHASES.map((phase) => ({
      ...phase,
      ms: sums.get(phase.id) ?? 0,
      share: total ? (sums.get(phase.id) ?? 0) / total : 0,
    }));
  }, [stats]);
  const history = useMemo(
    () => [...totals].sort((a, b) => (b.started_ms ?? 0) - (a.started_ms ?? 0)).slice(0, 16),
    [totals],
  );
  const longest = Math.max(1, ...history.map((run) => run.total_ms ?? 0));
  const maxMedian = Math.max(1, ...byMedian.map((stat) => stat.median_ms));
  const hasResources = stats.some(
    (stat) => stat.cores_median != null || stat.memory_max_bytes != null,
  );

  return (
    <SectionCard
      title="Where build time goes"
      description={`Typical stage durations across ${pipelineRuns} ${pipelineLabel} run${pipelineRuns === 1 ? "" : "s"} from this source. Completed stages of failed runs count too.`}
    >
      {!stats.length ? (
        <EmptyState title="No finished stages to measure yet." variant="compact" />
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Share of a typical run, by phase</div>
            <div className="flex h-4 w-full overflow-hidden rounded">
              {phaseShare
                .filter((phase) => phase.share > 0)
                .map((phase) => (
                  <div
                    key={phase.id}
                    style={{ width: `${phase.share * 100}%`, background: PHASE_COLOR[phase.id] }}
                    title={`${phase.label}: ${fmtDuration(phase.ms)} (${Math.round(phase.share * 100)}%)`}
                  />
                ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {phaseShare
                .filter((phase) => phase.share > 0)
                .map((phase) => (
                  <span key={phase.id} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLOR[phase.id] }} />
                    {phase.label} {Math.round(phase.share * 100)}% · {fmtDuration(phase.ms)}
                  </span>
                ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1.5 font-medium">Stage</th>
                  <th className="pb-1.5 font-medium">Typical</th>
                  <th className="pb-1.5 text-right font-medium">Median</th>
                  <th className="pb-1.5 text-right font-medium">
                    <HelpHint label="p90" tooltip="90% of runs finished this stage within this time." />
                  </th>
                  <th className="pb-1.5 text-right font-medium">Share</th>
                  {hasResources ? (
                    <>
                      <th className="pb-1.5 text-right font-medium">
                        <HelpHint label="Cores" tooltip="Median cores the stage kept busy: CPU seconds over wall seconds." />
                      </th>
                      <th className="pb-1.5 text-right font-medium">
                        <HelpHint label="Memory" tooltip="Largest resident memory seen at the stage's start or end." />
                      </th>
                    </>
                  ) : null}
                  <th className="pb-1.5 text-right font-medium">Runs</th>
                  <th className="pb-1.5 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((stat) => (
                  <tr key={stat.stage} className={`border-t border-border/60 ${stat.failures ? "row-neg" : ""}`}>
                    <td className="py-1.5 pr-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: PHASE_COLOR[stat.phase] }} />
                        {formatStageName(stat.stage)}
                      </span>
                    </td>
                    <td className="w-[30%] py-1.5 pr-2">
                      <div className="h-2 rounded-sm" style={{ width: `${(stat.median_ms / maxMedian) * 100}%`, background: PHASE_COLOR[stat.phase] }} />
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDuration(stat.median_ms)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDuration(stat.p90_ms)}</td>
                    <td className="py-1.5 text-right tabular-nums">{Math.round(stat.share * 100)}%</td>
                    {hasResources ? (
                      <>
                        <td className="py-1.5 text-right tabular-nums">{fmtCores(stat.cores_median)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtBytes(stat.memory_max_bytes)}</td>
                      </>
                    ) : null}
                    <td className="py-1.5 text-right tabular-nums">{stat.samples}</td>
                    <td className={`py-1.5 text-right tabular-nums ${stat.failures ? "tone-neg font-medium" : ""}`}>{stat.failures || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {byMedian.length > 10 ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                {expanded ? "Show the 10 longest" : `Show all ${byMedian.length} stages`}
              </button>
            ) : null}
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Run history (newest first)</div>
            <div className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
              {history.map((run) => (
                <RunHistoryRow key={run.run_id} run={run} longest={longest} selected={run.run_id === selected} />
              ))}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function RunHistoryRow({ run, longest, selected }: { run: PhaseTotals; longest: number; selected: boolean }) {
  const total = run.total_ms ?? 0;
  const label = run.started_ms
    ? new Date(run.started_ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : run.run_id;
  return (
    <>
      <div className={`flex min-w-0 items-center gap-1.5 ${selected ? "font-semibold" : ""}`} title={run.run_id}>
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATE_SWATCH[run.state]}`} />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-sm bg-muted/40" style={{ width: `${Math.max(1, (total / longest) * 100)}%` }}>
        {BUILD_PHASES.map((phase) => {
          const ms = run.phases[phase.id];
          if (!ms || !total) return null;
          return (
            <div
              key={phase.id}
              style={{ width: `${(ms / total) * 100}%`, background: PHASE_COLOR[phase.id] }}
              title={`${phase.label}: ${fmtDuration(ms)}`}
            />
          );
        })}
      </div>
      <div className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
        {fmtDuration(total)}
        {run.state !== "passed" ? ` · ${STATE_LABEL[run.state].toLowerCase()}` : ""}
      </div>
    </>
  );
}

function GatesCard({
  stats,
  failureClasses,
  catalog,
  pipelineRuns,
}: {
  stats: GateStat[];
  failureClasses: FailureClassStat[];
  catalog: CatalogGate[] | null;
  pipelineRuns: number;
}) {
  const failuresByGate = new Map(stats.map((stat) => [stat.gate, stat]));
  const [openPositions, setOpenPositions] = useState<Set<string>>(new Set());
  return (
    <SectionCard
      title="Checks and gates"
      description="Which checks stop builds, and how much compute had already run when they did. A check that fails late is a candidate for the preflight or dry run."
    >
      <div className="flex flex-col gap-5">
        {failureClasses.length ? (
          <div className="overflow-x-auto">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Why runs stop</div>
            <table className="w-full min-w-[30rem] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1.5 font-medium">Kind</th>
                  <th className="pb-1.5 text-right font-medium">Runs</th>
                  <th className="pb-1.5 text-right font-medium">Compute lost (median)</th>
                  <th className="pb-1.5 pl-3 font-medium">Stopped in</th>
                  <th className="pb-1.5 pl-3 font-medium">Most common reasons</th>
                </tr>
              </thead>
              <tbody>
                {failureClasses.map((stat) => (
                  <tr key={stat.failure_class} className="border-t border-border/60">
                    <td className="py-1.5 pr-2 font-medium">
                      {failureClassLabel(stat.failure_class)}
                      {stat.inferred ? (
                        <span
                          className="ml-1 font-normal text-muted-foreground"
                          title="These runs recorded no class; it is inferred from the error type, message and failing stage."
                        >
                          ({stat.inferred === stat.runs ? "inferred" : `${stat.inferred} inferred`})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {stat.runs} of {pipelineRuns}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDuration(stat.median_compute_lost_ms)}</td>
                    <td className="py-1.5 pl-3 text-muted-foreground">
                      {stat.stages
                        .slice(0, 3)
                        .map((item) => `${formatStageName(item.stage)}${item.count > 1 ? ` (${item.count})` : ""}`)
                        .join(" · ") || "—"}
                    </td>
                    <td className="py-1.5 pl-3 text-muted-foreground">
                      {stat.reasons
                        .slice(0, 2)
                        .map((item) => `${item.reason}${item.count > 1 ? ` (${item.count})` : ""}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {stats.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1.5 font-medium">Check</th>
                  <th className="pb-1.5 text-right font-medium">Failed</th>
                  <th className="pb-1.5 text-right font-medium">
                    <HelpHint
                      label="Compute lost"
                      tooltip="Median time into the build when the check failed: the run time a failure there throws away."
                    />
                  </th>
                  <th className="pb-1.5 pl-3 font-medium">Most common reasons</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat) => (
                  <tr key={stat.gate} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-2 font-medium">{formatStageName(stat.gate)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {stat.failures} of {pipelineRuns}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDuration(stat.median_offset_ms)}</td>
                    <td className="py-1.5 pl-3 text-muted-foreground">
                      {stat.reasons.length
                        ? stat.reasons
                            .slice(0, 3)
                            .map((reason) => `${reason.reason}${reason.count > 1 ? ` (${reason.count})` : ""}`)
                            .join(" · ")
                        : stat.last_message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No check has failed in the {pipelineRuns} run{pipelineRuns === 1 ? "" : "s"} from this source. Passing checks
            write no telemetry, so only failures show here.
          </p>
        )}

        {catalog ? (
          <div className="flex flex-col gap-3">
            <div className="text-xs text-muted-foreground">
              The US release build runs {catalog.length} checks. Where each one sits decides how much compute a failure
              wastes (from {BUILD_GATE_CATALOG_SOURCE.repo} @ {BUILD_GATE_CATALOG_SOURCE.commit}).
            </div>
            {GATE_POSITIONS.map((position) => {
              const gates = catalog.filter((gate) => gate.position === position.id);
              const collapsible = gates.length > 12;
              const open = !collapsible || openPositions.has(position.id);
              const shownGates = open ? gates : gates.filter((gate) => failuresByGate.has(gate.stage));
              return (
                <div key={position.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-semibold">
                      {position.label} <span className="font-normal text-muted-foreground">· {gates.length} checks</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{position.detail}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {shownGates.map((gate) => {
                      const failed = failuresByGate.get(gate.stage);
                      return (
                        <span
                          key={gate.stage}
                          title={gate.covers ?? gate.stage}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            failed ? "pill-neg font-medium" : "pill-neutral"
                          }`}
                        >
                          {formatStageName(gate.stage)}
                          {failed ? <span className="tabular-nums">· {failed.failures}×</span> : null}
                        </span>
                      );
                    })}
                    {collapsible ? (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenPositions((current) => {
                            const next = new Set(current);
                            if (next.has(position.id)) next.delete(position.id);
                            else next.add(position.id);
                            return next;
                          })
                        }
                        className="px-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        {open
                          ? "Hide the list"
                          : `${shownGates.length ? "Show all " : "Show the "}${gates.length} checks`}
                      </button>
                    ) : null}
                  </div>
                  {gates.some((gate) => gate.covers) ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {gates
                        .filter((gate) => gate.covers)
                        .map((gate) => `${formatStageName(gate.stage)}: ${gate.covers}`)
                        .join(" ")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
