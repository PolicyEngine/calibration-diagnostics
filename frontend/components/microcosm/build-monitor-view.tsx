"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

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
  type StopOutcome,
  type StopStat,
  type GateStat,
  type PhaseTotals,
  type SolverForecast,
  type SolverSegment,
  type StageForecast,
  type StageStat,
  formatStageName,
  phaseTotals,
  runDurationMs,
  sameStageSequence,
  solverPassLabel,
  solverSegments,
  spanDurationMs,
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
// Light stripes laid over a running stage's bar; `bar-running` moves them.
const RUNNING_STRIPES =
  "linear-gradient(45deg, rgb(255 255 255 / 0.32) 25%, transparent 25%, transparent 50%, rgb(255 255 255 / 0.32) 50%, rgb(255 255 255 / 0.32) 75%, transparent 75%, transparent)";
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
  // The build exited non-zero without raising and without a recorded gate block.
  refused: "Refused without a gate block",
  // A sampled spine build hit a named edge and discarded the attempt.
  aborted: "Rung aborted",
  // The gates refused, but the block's details could not be recorded.
  unrecorded_gate_block: "Gate block not recorded",
  error: "Error",
  build_failure: "Build failure",
  unexpected_process_exit: "Process exited unexpectedly",
  dry_run_refusal: "Refused in a dry run",
  stopped_without_final_event: "Stopped without a final event",
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

// The stage a run is in, or stopped in, to follow its state label
// ("Failed · in Target compilation", "Blocked by gates · at Gate battery").
function runWhere(run: BuildTimeline): string | null {
  if (run.state === "passed") return null;
  const top = run.spans.filter((span) => span.depth === 0);
  const stage =
    run.state === "running"
      ? (run.current_stage ?? top[top.length - 1]?.stage)
      : (run.failure?.stage ?? top[top.length - 1]?.stage ?? run.current_stage);
  if (!stage) return null;
  return `${run.state === "blocked" ? "at" : "in"} ${formatStageName(stage)}`;
}

// A run in the run selector: its state, start, length and where it is or
// stopped. The selector groups runs by pipeline; the overview shows the id.
function runOptionLabel(run: BuildTimeline, nowMs: number): string {
  const started = run.started_ms
    ? new Date(run.started_ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "unknown start";
  const duration = runDurationMs(run, nowMs);
  return [STATE_LABEL[run.state], started, duration != null ? fmtDuration(duration) : null, runWhere(run)]
    .filter(Boolean)
    .join(" · ");
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
    {
      id: "staging",
      label: "Hosted runs",
      hint: "Live collector runs plus historical Hugging Face telemetry",
    },
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
  // hosted telemetry is read only once it is the chosen source.
  const local = useBuildRuns("local");
  const localEnabled = local.data?.local_enabled ?? false;
  const localRuns = local.data?.runs ?? [];
  // Open local runs when this machine has them, unless the run carried over
  // from the Candidate tab exists only in hosted telemetry.
  const preferLocal =
    localEnabled &&
    (!preferredRunId || localRuns.some((run) => run.run_id === preferredRunId));
  const source: BuildRunSource = chosenSource ?? (preferLocal ? "local" : "staging");
  const staging = useBuildRuns("staging", source === "staging" && !local.isLoading);
  const list = source === "local" ? local : staging;
  const runs = list.data?.runs ?? [];
  const [selected, setSelected] = useState("");
  // The selector groups runs by pipeline, and puts runs whose stages differ
  // from the pipeline's newest run (an older build driver) in a group of
  // their own, as the forecast and statistics leave them out.
  const runGroups = useMemo(() => {
    const newest = new Map<string, BuildTimeline>();
    for (const run of runs) if (!newest.has(run.pipeline)) newest.set(run.pipeline, run);
    return new Map(
      runs.map((run) => [
        run.run_id,
        sameStageSequence(newest.get(run.pipeline)!, run)
          ? run.pipeline_label
          : `${run.pipeline_label} · earlier stage sequence`,
      ]),
    );
  }, [runs]);

  useEffect(() => {
    if (!runs.length) return;
    if (!runs.some((run) => run.run_id === selected)) {
      const preferred = runs.find((run) => run.run_id === preferredRunId);
      const running = runs.find((run) => run.state === "running");
      // Otherwise the newest run that ended with a final event (finished,
      // blocked or failed), whose telemetry says how it ended.
      const ended = runs.find((run) => run.state !== "stalled");
      setSelected((preferred ?? running ?? ended ?? runs[0]).run_id);
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
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
            {/* A hosted dashboard never reads local run folders, so it
                offers only the staging repository. */}
            {localEnabled ? (
              <SourceToggle
                source={source}
                localEnabled={localEnabled}
                onChange={(next) => {
                  setChosenSource(next);
                  setSelected("");
                }}
              />
            ) : null}
            <ToolbarSelect
              label="Run"
              value={selected}
              options={
                runs.length
                  ? runs.map((run) => ({
                      value: run.run_id,
                      label: runOptionLabel(run, list.data?.now_ms ?? Date.now()),
                      group: runGroups.get(run.run_id),
                    }))
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
          title={source === "local" ? "Local runs are off" : "Hosted runs unavailable"}
          description={list.data.detail ?? undefined}
        />
      ) : !runs.length ? (
        <EmptyState
          title="No build runs found"
          description={
            source === "local"
              ? `No run folders (progress.json and events.ndjson) under ${list.data?.roots.join(", ") || "the configured directory"}.`
              : "The collector and historical staging repository have no runs for this country."
          }
        />
      ) : detail.isLoading && !data ? (
        <LoadingBlock label="Loading run…" />
      ) : detail.error ? (
        <EmptyState title="Run unavailable" description={String(detail.error.message)} />
      ) : data ? (
        <>
          <StaleSourceNotice runs={runs} source={source} nowMs={nowMs} />
          <RunOverview run={data.run} forecast={data.forecast} nowMs={nowMs} />
          <TimelineCard run={data.run} forecast={data.forecast} nowMs={nowMs} />
          <RunHistoryCard runs={runs} selected={data.run} nowMs={nowMs} onSelect={selectRun} />
          <TimeBudgetCard
            run={data.run}
            nowMs={nowMs}
            pipelineLabel={data.run.pipeline_label}
            pipelineRuns={data.pipeline_runs}
            otherSequenceRuns={data.other_sequence_runs ?? 0}
            stats={data.stage_stats}
            totals={data.phase_totals}
          />
          <GatesCard
            stats={data.gate_stats}
            stops={data.stop_stats ?? []}
            catalog={data.gate_catalog}
            pipelineRuns={data.pipeline_runs}
          />
          {list.data?.problems.length ? (
            <SectionCard
              title="Runs that could not be read"
              description="Their telemetry does not match the staging contract."
              descriptionClassName="max-w-none"
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

// Runs reach the staging repository only when a build uploads them, so a
// quiet source usually means builds ran without staging, not that none ran.
const STALE_SOURCE_MS = 14 * 24 * 3_600_000;

function StaleSourceNotice({
  runs,
  source,
  nowMs,
}: {
  runs: BuildTimeline[];
  source: BuildRunSource;
  nowMs: number;
}) {
  const newest = Math.max(0, ...runs.map((run) => run.started_ms ?? 0));
  if (source !== "staging" || !newest || nowMs - newest < STALE_SOURCE_MS) return null;
  return (
    <div className="rounded-md border px-3 py-2 text-sm pill-warn">
      The newest run in the staging repository started {fmtDuration(nowMs - newest)} ago. Builds that ran with{" "}
      <code className="font-mono">--no-staging</code>, or whose uploads failed, do not appear here.
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
        run.source === "local" ? "local run folder" : "hosted telemetry",
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
                  ? `${run.state === "blocked" ? "Refused at" : "Failed in"} ${formatStageName(run.failure.stage)}`
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
                  }${forecast.solver ? ` · ${searchProgress(forecast.solver)}` : ""}`
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
                {forecastBasis(forecast)}
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
            {`The last telemetry came ${fmtDuration(elapsed)} after the run started, ${
              silentFor != null && silentFor > 24 * 3_600_000
                ? `on ${fmtClock(run.updated_ms, nowMs)}`
                : `${fmtDuration(silentFor)} ago`
            }, and the run wrote no final event. The telemetry does not say why it stopped, or whether the process is still working without reporting.`}
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
              {run.state === "blocked" ? "Refused by gates" : "Failed"}
              {run.failure.stage ? ` ${run.state === "blocked" ? "at" : "in"} ${formatStageName(run.failure.stage)}` : ""}
              {run.started_ms != null && run.ended_ms != null
                ? ` after ${fmtDuration(run.ended_ms - run.started_ms)}`
                : ""}
              {[run.failure.error_type, run.failure.error_code].filter(Boolean).map((value) => (
                <span key={value} className="ml-2 rounded border border-current px-1.5 py-px font-mono text-[11px] font-normal">
                  {value}
                </span>
              ))}
            </div>
            {run.failure.message ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs">{run.failure.message}</p>
            ) : null}
            {run.failure.diagnostic_reference ? (
              <p className="mt-1 text-xs">
                Details on the build machine: <code className="font-mono">{run.failure.diagnostic_reference}</code>
              </p>
            ) : null}
            <FailureLines run={run} />
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

// What the forecast rests on: finished runs of the same pipeline and stage
// sequence, or only this run's own measured rate.
function forecastBasis(forecast: BuildForecast | null): string {
  if (!forecast || forecast.method === "none") return "No comparable runs";
  if (forecast.method === "rate_only") {
    return forecast.solver
      ? "Forecast from this run's epoch rate and past size-search pass counts"
      : "Forecast from this run's measured rate";
  }
  const count = forecast.finished_runs;
  return `Forecast from ${count} finished comparable run${count === 1 ? "" : "s"}`;
}

function searchProgress(solver: SolverForecast): string {
  const past = solver.history_search_passes.filter((count) => count > 0);
  const range = past.length
    ? Math.min(...past) === Math.max(...past)
      ? `${past[0]}`
      : `${Math.min(...past)}–${Math.max(...past)}`
    : null;
  const search = solver.search_passes
    ? `size-search pass ${solver.search_passes}`
    : `${solverPassLabel(solver.pass).toLowerCase()}, before the size search`;
  return range ? `${search}; past runs needed ${range}` : search;
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
  label: string;
  phase: BuildPhase;
  start: number;
  end: number;
  status: StageForecast["status"] | "failed";
  basis: StageForecast["basis"];
  span: StageSpan | null;
  // A stretch inside a calibration stage (a solver pass, or time with no
  // epochs logged), shown indented under its stage.
  segment: SolverSegment | null;
}

// A pass's epochs and speed, most telling first: where a running pass is,
// how fast a finished one went.
function segmentDetail(segment: SolverSegment, open: boolean): string[] {
  const pass = segment.pass;
  if (!pass) return [];
  const progress =
    pass.last_epoch != null && pass.epochs != null
      ? pass.complete
        ? `${pass.epochs} epochs`
        : open
          ? `epoch ${pass.last_epoch} of ${pass.epochs}`
          : `stopped at epoch ${pass.last_epoch} of ${pass.epochs}`
      : null;
  const speed = pass.last_epoch
    ? `${((pass.end_ms - pass.start_ms) / 1000 / pass.last_epoch).toFixed(1)} s/epoch`
    : null;
  const parts = pass.complete ? [speed, progress] : [progress, speed];
  return parts.filter((part): part is string => part != null);
}

// The width of an element, kept current as it resizes.
function useElementWidth(): [(element: HTMLElement | null) => void, number | null] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

// Width of a bar label in the timeline's 10 px type: measured on a canvas in
// the browser, estimated where there is none.
let labelContext: CanvasRenderingContext2D | null | undefined;
function labelWidth(text: string): number {
  if (labelContext === undefined) {
    labelContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (labelContext) labelContext.font = `10px ${getComputedStyle(document.body).fontFamily}`;
  }
  const measured = labelContext ? labelContext.measureText(text).width : text.length * 5.6;
  return measured * 1.05 + 8;
}

type LabelPlace = "inside" | "left" | "right";

// Where a bar's label goes: right of the bar, inside it, or left of it,
// whichever holds it whole. When none does, the least important parts are
// dropped (the tooltip keeps them all) until it fits.
function placeLabel(
  parts: string[],
  areaWidth: number | null,
  startFraction: number,
  endFraction: number,
  // Room taken by anything drawn before the text (the live dot).
  leadWidth = 0,
): { text: string; place: LabelPlace } {
  if (areaWidth == null) {
    const place: LabelPlace =
      endFraction - startFraction > 0.45 ? "inside" : endFraction > 0.85 ? "left" : "right";
    return { text: parts.join(" · "), place };
  }
  const left = startFraction * areaWidth;
  const bar = (endFraction - startFraction) * areaWidth;
  const right = areaWidth - endFraction * areaWidth;
  for (let count = parts.length; count >= 1; count -= 1) {
    const text = parts.slice(0, count).join(" · ");
    const needed = labelWidth(text) + leadWidth;
    if (right >= needed) return { text, place: "right" };
    if (bar >= needed) return { text, place: "inside" };
    if (left >= needed) return { text, place: "left" };
  }
  const place: LabelPlace = right >= left && right >= bar ? "right" : bar >= left ? "inside" : "left";
  return { text: parts[0] ?? "", place };
}

function solverRows(
  row: TimelineRow,
  run: BuildTimeline,
  runStart: number,
  nowOffset: number,
): TimelineRow[] {
  if (!row.span || !run.solver_passes?.length) return [];
  return solverSegments(row.span, run, runStart + nowOffset).map((segment, index) => {
    const open = segment.end_ms == null;
    return {
      key: `${row.key}-segment-${index}`,
      stage: row.stage,
      label: segment.label,
      phase: row.phase,
      start: segment.start_ms - runStart,
      end: Math.max(segment.start_ms, segment.end_ms ?? runStart + nowOffset) - runStart,
      status: open ? "running" : "done",
      basis: "observed",
      span: null,
      segment,
    };
  });
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
  const [measureArea, areaWidth] = useElementWidth();
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
    label: formatStageName(stage.stage),
    segment: null,
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
  // Every stage gets a row, however short: a seconds-long stage is still a
  // step the build went through. A stage that ran the solver is followed by
  // its passes and the stretches between them.
  const visible = rows.flatMap((row) =>
    run.started_ms == null ? [row] : [row, ...solverRows(row, run, run.started_ms, elapsed)],
  );
  const ticks = axisTicks(domain);

  if (!rows.length) {
    return (
      <SectionCard title="Timeline">
        <EmptyState title="No stage events yet." variant="compact" />
      </SectionCard>
    );
  }

  const barStyle = (row: TimelineRow): CSSProperties => {
    const place = {
      left: pct(row.start),
      width: width(row.start, row.end),
      // Stretches without epochs are drawn faint, passes at full strength.
      opacity: row.segment && !row.segment.pass ? 0.35 : 1,
    };
    if (row.status === "running") {
      // Moving stripes; solid up to now, faded where the bar runs on to the
      // forecast end.
      const color = PHASE_COLOR[row.phase];
      const done =
        row.end > row.start ? Math.min(100, Math.max(0, ((elapsed - row.start) / (row.end - row.start)) * 100)) : 100;
      return {
        ...place,
        backgroundImage: `${RUNNING_STRIPES}, linear-gradient(to right, ${color} ${done}%, color-mix(in srgb, ${color} 35%, transparent) ${done}%)`,
        backgroundSize: "16px 16px, 100% 100%",
      };
    }
    return {
      ...place,
      background:
        row.status === "pending" ? PENDING_FILL : row.status === "failed" ? FAILED_COLOR : PHASE_COLOR[row.phase],
    };
  };

  return (
    <SectionCard
      title="Timeline"
      descriptionClassName="max-w-none"
      description={
        run.state === "running"
          ? "Solid bars are stages that ran; hatched bars are what comparable runs did next, stretched to the forecast. The band marks the 90% finish range. Calibration is split into its solver passes; faint bars are time with no epochs logged."
          : "Each stage of the run on one time axis. Calibration is split into its solver passes; faint bars are time with no epochs logged."
      }
    >
      <div className="flex flex-col gap-1">
        <div className="mt-2 grid grid-cols-[minmax(8rem,14rem)_1fr] gap-x-3 gap-y-1 text-xs">
          <div className="font-medium text-muted-foreground">Whole run</div>
          <div ref={measureArea} className="relative h-6 rounded bg-muted/40">
            {rows.map((row) => (
              <div
                key={`whole-${row.key}`}
                className={`absolute top-0 h-full ${row.status === "running" ? "bar-running" : ""}`}
                style={barStyle(row)}
                title={`${row.label}: ${fmtDuration(row.end - row.start)}`}
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
              nowOffset={run.state === "running" ? elapsed : null}
              areaWidth={areaWidth}
              startFraction={Math.min(1, row.start / domain)}
              endFraction={Math.min(1, Math.max(row.end, row.start + 0.0025 * domain) / domain)}
            />
          ))}

          <div />
          <div className="relative mt-1 h-4 border-t border-border text-[10px] text-muted-foreground">
            {ticks.map((tick) => (
              <span key={tick} className="absolute -translate-x-1/2 pt-0.5 tabular-nums" style={{ left: pct(tick) }}>
                {tickLabel(tick)}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <PhaseLegend />
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
  nowOffset,
  areaWidth,
  startFraction,
  endFraction,
}: {
  row: TimelineRow;
  barStyle: CSSProperties;
  nowLeft: string | null;
  nowOffset: number | null;
  // The bar area's width in pixels (null before it is measured), and the
  // bar's ends as fractions of it.
  areaWidth: number | null;
  startFraction: number;
  endFraction: number;
}) {
  const label =
    row.status === "running"
      ? "running"
      : row.status === "pending"
        ? "expected"
        : row.status === "failed"
          ? "failed"
          : null;
  // Most important first: a label that does not fit loses its last parts.
  const parts = [
    row.status === "running" && !row.segment && nowOffset != null && row.end > nowOffset + 60_000
      ? `${fmtDuration(nowOffset - row.start)} so far, about ${fmtDuration(row.end - row.start)} in all`
      : fmtDuration(row.end - row.start),
    // A solver pass's epochs say more than that it is running.
    ...(row.segment ? segmentDetail(row.segment, row.status === "running") : []),
    label && row.basis === "measured_rate" ? `${label} (measured rate)` : label,
    row.span && stageCores(row.span) != null ? `${fmtCores(stageCores(row.span))} cores` : null,
    row.span && stageMemoryBytes(row.span) != null ? fmtBytes(stageMemoryBytes(row.span)) : null,
    row.span?.work ? `${row.span.work.done} of ${row.span.work.total} ${plural(row.span.work.unit ?? "unit")}` : null,
  ].filter((part): part is string => Boolean(part));
  const full = parts.join(" · ");
  const running = row.status === "running";
  const { text, place: labelPlace } = placeLabel(parts, areaWidth, startFraction, endFraction, running ? 10 : 0);
  const swatchSize = row.segment ? "h-1.5 w-1.5" : "h-2 w-2";
  const swatchColor = row.status === "failed" ? FAILED_COLOR : PHASE_COLOR[row.phase];
  return (
    <>
      <div
        className={`flex min-w-0 items-center gap-1.5 ${row.segment ? "pl-3.5 text-muted-foreground" : ""}`}
        title={row.segment ? row.label : row.stage}
      >
        {running ? (
          // A pulsing dot marks what is running now.
          <span aria-hidden="true" className={`relative flex shrink-0 ${swatchSize}`}>
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping"
              style={{ background: swatchColor }}
            />
            <span className="relative inline-flex h-full w-full rounded-full" style={{ background: swatchColor }} />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={`shrink-0 rounded-sm ${swatchSize}`}
            style={{ background: swatchColor, opacity: row.segment && !row.segment.pass ? 0.35 : 1 }}
          />
        )}
        <span
          className={`truncate ${
            row.status === "pending" ? "text-muted-foreground" : running ? "font-medium text-foreground" : ""
          }`}
        >
          {row.label}
        </span>
      </div>
      {/* Labels that do not fit are clipped; the tooltip has the full text. */}
      <div className="relative h-5 overflow-hidden" title={`${row.label}: ${full}`}>
        <div className={`absolute top-0.5 h-4 rounded-sm ${running ? "bar-running" : ""}`} style={barStyle} />
        <span
          className={`absolute top-0.5 whitespace-nowrap text-[10px] leading-4 ${
            labelPlace === "inside"
              ? // On moving stripes the text needs a plain backing to stay readable.
                running
                ? "ml-1 rounded-sm bg-background/85 px-1"
                : "pl-1.5"
              : labelPlace === "left"
                ? "pr-1"
                : "pl-1"
          } ${running || labelPlace === "inside" ? "font-medium text-foreground" : "text-muted-foreground"}`}
          style={
            labelPlace === "inside"
              ? { left: barStyle.left }
              : labelPlace === "left"
                ? { right: `calc(100% - ${barStyle.left})` }
                : { left: `calc(${barStyle.left} + ${barStyle.width})` }
          }
        >
          {running ? (
            <span
              aria-hidden="true"
              className="live-blink swatch-info mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
            />
          ) : null}
          {text}
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

// What one run did in each of its top-level stages: how long it spent there
// and how the stage ended for it.
interface RunStage {
  ms: number;
  status: "completed" | "running" | "failed" | "silent";
}

function runStages(run: BuildTimeline, nowMs: number): Map<string, RunStage> {
  const top = run.spans.filter((span) => span.depth === 0);
  const last = top[top.length - 1];
  const stages = new Map<string, RunStage>();
  for (const span of top) {
    const status: RunStage["status"] =
      span.end_ms == null
        ? "running"
        : span.status === "failed"
          ? "failed"
          : run.state === "stalled" && span === last
            ? "silent"
            : "completed";
    const previous = stages.get(span.stage);
    stages.set(span.stage, {
      ms: (previous?.ms ?? 0) + spanDurationMs(span, nowMs),
      status: previous?.status === "failed" ? "failed" : status,
    });
  }
  return stages;
}

// A stage this run is in that no compared run has finished yet.
function emptyStat(span: StageSpan): StageStat {
  return {
    stage: span.stage,
    phase: span.phase,
    is_gate: span.is_gate,
    samples: 0,
    failures: 0,
    median_ms: 0,
    p90_ms: 0,
    max_ms: 0,
    finished_median_ms: null,
    finished_p90_ms: null,
    cut_short: 0,
    median_offset_ms: 0,
    share: 0,
    cores_median: null,
    memory_max_bytes: null,
  };
}

function ThisRunCell({ stage }: { stage: RunStage | undefined }) {
  if (!stage) return <span className="text-muted-foreground">—</span>;
  if (stage.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 font-medium">
        <span aria-hidden="true" className="live-blink swatch-info inline-block h-1.5 w-1.5 rounded-full" />
        {fmtDuration(stage.ms)} so far
      </span>
    );
  }
  if (stage.status === "failed") return <span className="tone-neg">failed after {fmtDuration(stage.ms)}</span>;
  if (stage.status === "silent") return <span>went silent after {fmtDuration(stage.ms)}</span>;
  return <span>{fmtDuration(stage.ms)}</span>;
}

function TimeBudgetCard({
  run,
  nowMs,
  pipelineLabel,
  pipelineRuns,
  otherSequenceRuns,
  stats,
  totals,
}: {
  run: BuildTimeline;
  nowMs: number;
  pipelineLabel: string;
  pipelineRuns: number;
  otherSequenceRuns: number;
  stats: StageStat[];
  totals: PhaseTotals[];
}) {
  const [expanded, setExpanded] = useState(false);
  const thisRun = useMemo(() => runStages(run, nowMs), [run, nowMs]);
  // Every stage a compared run reached, plus any this run is in that none
  // has finished yet (its open stage). Longest typical time first; stages
  // without one follow by this run's time in them.
  const rows = useMemo(() => {
    const known = new Set(stats.map((stat) => stat.stage));
    const extra = run.spans
      .filter((span) => span.depth === 0 && !known.has(span.stage))
      .filter((span, index, spans) => spans.findIndex((other) => other.stage === span.stage) === index)
      .map(emptyStat);
    const key = (stat: StageStat) => stat.finished_median_ms ?? thisRun.get(stat.stage)?.ms ?? 0;
    return [...stats, ...extra].sort(
      (a, b) =>
        Number(b.finished_median_ms != null) - Number(a.finished_median_ms != null) ||
        key(b) - key(a) ||
        b.samples - a.samples,
    );
  }, [stats, run, thisRun]);
  const shown = expanded ? rows : rows.slice(0, 10);
  // A typical run exists only once a run of this stage sequence has finished.
  const anyFinished = totals.some((total) => total.state === "passed" || total.state === "blocked");
  const phaseShare = useMemo(() => {
    const sums = new Map<BuildPhase, number>();
    for (const stat of stats) {
      sums.set(stat.phase, (sums.get(stat.phase) ?? 0) + (stat.finished_median_ms ?? 0));
    }
    const total = [...sums.values()].reduce((a, b) => a + b, 0);
    return BUILD_PHASES.map((phase) => ({
      ...phase,
      ms: sums.get(phase.id) ?? 0,
      share: total ? (sums.get(phase.id) ?? 0) / total : 0,
    }));
  }, [stats]);
  const maxMedian = Math.max(1, ...rows.map((stat) => stat.finished_median_ms ?? 0));
  const hasResources = stats.some(
    (stat) => stat.cores_median != null || stat.memory_max_bytes != null,
  );

  return (
    <SectionCard
      title="Where build time goes"
      descriptionClassName="max-w-none"
      description={`Stage times across the ${pipelineRuns} ${pipelineLabel} run${pipelineRuns === 1 ? "" : "s"} from this source that went through this run's stages, this run included. A typical time comes only from runs that completed the stage; "This run" shows the selected run on its own.${
        otherSequenceRuns
          ? ` ${otherSequenceRuns} other run${otherSequenceRuns === 1 ? "" : "s"} of this pipeline went through a different stage sequence and ${otherSequenceRuns === 1 ? "is" : "are"} left out here and in the forecast.`
          : ""
      }`}
    >
      {!rows.length ? (
        <EmptyState title="No stages to measure yet." variant="compact" />
      ) : (
        <div className="flex flex-col gap-5">
          {!anyFinished ? (
            <p className="text-xs text-muted-foreground">
              No run with this stage sequence has finished yet, so there is no typical run to split by phase.
            </p>
          ) : (
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
          )}

          {/* The negative margin keeps the cells' side padding from pushing the
              text out of line with the card's other content. */}
          <div className="@container -mx-2 overflow-x-auto">
            <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
              <thead className="text-left text-muted-foreground">
                <tr className="whitespace-nowrap">
                  <th className="pb-1.5 font-medium">Stage</th>
                  {/* In a narrow card the bar gives way to the stage names. */}
                  <th className="hidden w-[24%] pb-1.5 font-medium @2xl:table-cell">Typical</th>
                  <th className="pb-1.5 text-right font-medium">Median</th>
                  <th className="pb-1.5 text-right font-medium">
                    <HelpHint label="p90" tooltip="90% of the runs that completed this stage did so within this time." />
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
                  <th className="pb-1.5 text-right font-medium">
                    <HelpHint
                      label="Completed"
                      tooltip="Runs that ran this stage to its end, of the runs that reached it. Only these give the typical times; the rest failed in it or went silent in it."
                    />
                  </th>
                  <th className="pb-1.5 text-right font-medium">
                    <HelpHint label="This run" tooltip="The selected run's time in this stage, and how the stage ended for it." />
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((stat) => {
                  const completed = stat.samples - stat.cut_short;
                  const silent = stat.cut_short - stat.failures;
                  return (
                    <tr key={stat.stage} className="border-t border-border/60 align-top">
                      <td className="whitespace-nowrap py-1.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ background: PHASE_COLOR[stat.phase] }} />
                          {formatStageName(stat.stage)}
                        </span>
                      </td>
                      <td className="hidden py-1.5 align-middle @2xl:table-cell">
                        {stat.finished_median_ms != null ? (
                          <div
                            className="h-2 rounded-sm"
                            style={{
                              width: `${Math.max(0.5, (stat.finished_median_ms / maxMedian) * 100)}%`,
                              background: PHASE_COLOR[stat.phase],
                            }}
                          />
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtDuration(stat.finished_median_ms)}</td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtDuration(stat.finished_p90_ms)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {stat.finished_median_ms != null ? `${Math.round(stat.share * 100)}%` : "—"}
                      </td>
                      {hasResources ? (
                        <>
                          <td className="py-1.5 text-right tabular-nums">{fmtCores(stat.cores_median)}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtBytes(stat.memory_max_bytes)}</td>
                        </>
                      ) : null}
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                        {stat.samples ? `${completed} of ${stat.samples}` : "—"}
                        {stat.failures ? <div className="tone-neg text-[11px]">{stat.failures} failed</div> : null}
                        {silent > 0 ? <div className="text-[11px] text-muted-foreground">{silent} went silent</div> : null}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                        <ThisRunCell stage={thisRun.get(stat.stage)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 10 ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 px-2 text-xs font-medium text-primary hover:underline"
              >
                {expanded ? "Show the 10 longest" : `Show all ${rows.length} stages`}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// Every run of the selected run's pipeline, newest first, as a list to open
// runs from. Runs whose stages differ from the selected run's are listed
// apart, as its statistics and forecast leave them out.
function RunHistoryCard({
  runs,
  selected,
  nowMs,
  onSelect,
}: {
  runs: BuildTimeline[];
  selected: BuildTimeline;
  nowMs: number;
  onSelect: (runId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const pipelineRuns = runs.filter((run) => run.pipeline === selected.pipeline);
  const same = pipelineRuns.filter(
    (run) => run.run_id === selected.run_id || sameStageSequence(selected, run),
  );
  const other = pipelineRuns.filter((run) => !same.includes(run));
  const totals = new Map(pipelineRuns.map((run) => [run.run_id, phaseTotals(run, nowMs)]));
  const longest = Math.max(1, ...[...totals.values()].map((total) => total.total_ms ?? 0));
  const limit = 12;
  const shownSame = showAll ? same : same.slice(0, limit);
  const shownOther = showAll ? other : other.slice(0, Math.max(0, limit - shownSame.length));
  const hidden = pipelineRuns.length - shownSame.length - shownOther.length;
  const phases = BUILD_PHASES.filter((phase) =>
    [...totals.values()].some((total) => total.phases[phase.id] > 0),
  );

  const row = (run: BuildTimeline) => (
    <RunHistoryItem
      key={run.run_id}
      run={run}
      total={totals.get(run.run_id)!}
      longest={longest}
      selected={run.run_id === selected.run_id}
      onSelect={onSelect}
    />
  );

  return (
    <SectionCard
      title="Run history"
      descriptionClassName="max-w-none"
      description={`Every ${selected.pipeline_label} run from this source, newest first, with how long it ran and how it ended. Bars share one time scale and split by phase. Select a run to open it.`}
    >
      <div className="flex flex-col gap-1">
        {shownSame.map(row)}
        {shownOther.length ? (
          <>
            <div className="mt-3 border-t border-border px-2 pb-1 pt-3 text-xs text-muted-foreground">
              Different stage sequence · left out of this run&apos;s statistics and forecast
            </div>
            <div className="opacity-70">{shownOther.map(row)}</div>
          </>
        ) : null}
        {hidden > 0 || showAll ? (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="mt-1 self-start px-2 text-xs font-medium text-primary hover:underline"
          >
            {showAll ? "Show fewer runs" : `Show all ${pipelineRuns.length} runs`}
          </button>
        ) : null}
        {phases.length ? (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground">
            {phases.map((phase) => (
              <span key={phase.id} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLOR[phase.id] }} />
                {phase.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function RunHistoryItem({
  run,
  total,
  longest,
  selected,
  onSelect,
}: {
  run: BuildTimeline;
  total: PhaseTotals;
  longest: number;
  selected: boolean;
  onSelect: (runId: string) => void;
}) {
  const ms = total.total_ms ?? 0;
  const running = run.state === "running";
  const where = runWhere(run);
  const started = run.started_ms
    ? new Date(run.started_ms).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unknown start";
  return (
    <button
      type="button"
      onClick={() => onSelect(run.run_id)}
      aria-current={selected ? "true" : undefined}
      title={run.run_id}
      className={`grid w-full grid-cols-[minmax(9rem,15rem)_1fr_auto] items-center gap-x-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50"
      }`}
    >
      <span className="flex min-w-0 items-start gap-2">
        {running ? (
          <span aria-hidden="true" className="relative mt-1 flex h-2 w-2 shrink-0">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping ${STATE_SWATCH[run.state]}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${STATE_SWATCH[run.state]}`} />
          </span>
        ) : (
          <span aria-hidden="true" className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATE_SWATCH[run.state]}`} />
        )}
        <span className="flex min-w-0 flex-col">
          <span className={`truncate ${selected ? "font-semibold" : "font-medium"}`}>{started}</span>
          <span className="truncate text-muted-foreground">
            {STATE_LABEL[run.state]}
            {where ? ` · ${where}` : ""}
          </span>
        </span>
      </span>
      <span className="relative flex h-3 overflow-hidden rounded-sm bg-muted/40" style={{ width: `${Math.max(1, (ms / longest) * 100)}%` }}>
        {BUILD_PHASES.map((phase) => {
          const phaseMs = total.phases[phase.id];
          if (!phaseMs || !ms) return null;
          return (
            <span
              key={phase.id}
              style={{ width: `${(phaseMs / ms) * 100}%`, background: PHASE_COLOR[phase.id] }}
              title={`${phase.label}: ${fmtDuration(phaseMs)}`}
            />
          );
        })}
        {running ? (
          <span
            aria-hidden="true"
            className="bar-running absolute inset-0"
            style={{ backgroundImage: RUNNING_STRIPES, backgroundSize: "16px 16px" }}
          />
        ) : null}
      </span>
      <span className={`whitespace-nowrap text-right tabular-nums ${running ? "font-medium" : "text-muted-foreground"}`}>
        {fmtDuration(ms)}
        {running ? " so far" : ""}
      </span>
    </button>
  );
}

const STOP_OUTCOME_LABEL: Record<StopOutcome, string> = {
  failed: "Failed",
  blocked: "Refused by gates",
  stalled: "Went silent",
};

// What a group of stopped runs recorded about the stop, as recorded: error
// types and codes, failure classes, and messages or failure lines.
function RecordedValues({ stat }: { stat: StopStat }) {
  if (stat.outcome === "stalled") {
    return <span className="text-muted-foreground">No final event, so nothing about the cause</span>;
  }
  const times = (count: number) => (stat.runs > 1 && count > 1 ? ` ×${count}` : "");
  const codes = [
    ...stat.error_types.map((item) => ({ ...item, title: "Error type" })),
    ...stat.error_codes.map((item) => ({ ...item, title: "Error code" })),
  ];
  return (
    <div className="flex flex-col gap-1">
      {codes.length || stat.failure_classes.length ? (
        <div className="flex flex-wrap gap-1">
          {codes.map((item) => (
            <span
              key={`${item.title}-${item.value}`}
              title={item.title}
              className="rounded border border-border px-1.5 py-px font-mono text-[11px]"
            >
              {item.value}
              {times(item.count)}
            </span>
          ))}
          {stat.failure_classes.map((item) => (
            <span
              key={`class-${item.value}`}
              title="Failure class the run recorded"
              className="rounded border border-border px-1.5 py-px text-[11px]"
            >
              {failureClassLabel(item.value)}
              {times(item.count)}
            </span>
          ))}
        </div>
      ) : null}
      {stat.reasons.slice(0, 3).map((item) => (
        <span key={item.value} className="break-words text-muted-foreground">
          {item.value}
          {times(item.count)}
        </span>
      ))}
      {stat.reasons.length > 3 ? (
        <span className="text-muted-foreground">and {stat.reasons.length - 3} more</span>
      ) : null}
      {stat.unexplained ? (
        <span className="text-muted-foreground">
          {stat.unexplained === stat.runs ? "Nothing recorded" : `${stat.unexplained} recorded nothing`}
        </span>
      ) : null}
    </div>
  );
}

function GatesCard({
  stats,
  stops,
  catalog,
  pipelineRuns,
}: {
  stats: GateStat[];
  stops: StopStat[];
  catalog: CatalogGate[] | null;
  pipelineRuns: number;
}) {
  const failuresByGate = new Map(stats.map((stat) => [stat.gate, stat]));
  const [openPositions, setOpenPositions] = useState<Set<string>>(new Set());
  return (
    <SectionCard
      title="Why runs stop"
      descriptionClassName="max-w-none"
      description={`Runs of this pipeline and stage sequence that did not finish (${stops.reduce((sum, stop) => sum + stop.runs, 0)} of ${pipelineRuns}): where and how they stopped, how far into the run, and what their telemetry recorded. Only recorded values show; a run that recorded nothing says so.`}
    >
      <div className="flex flex-col gap-5">
        {stops.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
              <thead className="text-left text-muted-foreground">
                <tr className="whitespace-nowrap">
                  <th className="pb-1.5 font-medium">Stopped in</th>
                  <th className="pb-1.5 font-medium">How</th>
                  <th className="pb-1.5 text-right font-medium">Runs</th>
                  <th className="pb-1.5 text-right font-medium">
                    <HelpHint
                      label="Time at stop"
                      tooltip="Median time from the start of the run to where it stopped: the run time a stop there throws away."
                    />
                  </th>
                  <th className="w-1/2 pb-1.5 font-medium">What the runs recorded</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((stop) => (
                  <tr key={`${stop.outcome}-${stop.stage}`} className="border-t border-border/60 align-top">
                    <td className="whitespace-nowrap py-1.5 font-medium">
                      {stop.stage ? formatStageName(stop.stage) : "—"}
                    </td>
                    <td className={`whitespace-nowrap py-1.5 ${stop.outcome === "stalled" ? "" : "tone-neg"}`}>
                      {STOP_OUTCOME_LABEL[stop.outcome]}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{stop.runs}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                      {fmtDuration(stop.median_time_at_stop_ms)}
                    </td>
                    <td className="py-1.5">
                      <RecordedValues stat={stop} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No run of this pipeline and stage sequence failed, was refused by its gates or went silent.
          </p>
        )}

        {stats.length ? (
          <div className="-mx-2 overflow-x-auto">
            <div className="mb-1.5 px-2 text-xs font-medium text-muted-foreground">Checks that failed</div>
            <table className="w-full text-xs [&_td]:px-2 [&_th]:px-2">
              <thead className="text-left text-muted-foreground">
                <tr className="whitespace-nowrap">
                  <th className="pb-1.5 font-medium">Check</th>
                  <th className="pb-1.5 text-right font-medium">Failed</th>
                  <th className="pb-1.5 text-right font-medium">
                    <HelpHint
                      label="Time at failure"
                      tooltip="Median time into the build when the check failed: the run time a failure there throws away."
                    />
                  </th>
                  <th className="w-1/2 pb-1.5 font-medium">Most common reasons</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat) => (
                  <tr key={stat.gate} className="border-t border-border/60 align-top">
                    <td className="whitespace-nowrap py-1.5 font-medium">{formatStageName(stat.gate)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                      {stat.failures} of {pipelineRuns}
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{fmtDuration(stat.median_offset_ms)}</td>
                    <td className="py-1.5 text-muted-foreground">
                      {stat.reasons.length
                        ? stat.reasons
                            .slice(0, 3)
                            .map((reason) => `${reason.reason}${reason.count > 1 ? ` ×${reason.count}` : ""}`)
                            .join(" · ")
                        : stat.last_message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : catalog ? (
          <p className="text-xs text-muted-foreground">
            No check failed in these runs. Checks that pass write no telemetry, so only failures would show here.
          </p>
        ) : null}

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
