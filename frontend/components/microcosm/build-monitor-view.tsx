"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import { useViewerZone, ViewerTime } from "@/components/microcosm/viewer-time";
import { ApiError } from "@/lib/api/client";
import { useBuildRun, useBuildRuns } from "@/lib/api/hooks/use-microcosm";
import { detailBehindList } from "@/lib/microcosm/build-refresh";
import { hostedListRequested, localListRequested, opensLocalRuns } from "@/lib/microcosm/build-list-requests";
import {
  buildRunToShow,
  placeholderHidesFailure,
  runDetailLoading,
  waitsForRunList,
} from "@/lib/microcosm/build-run-selection";
import { filteredAxis, phasesByFirstAppearance } from "@/lib/microcosm/timeline-layout";
import {
  NO_FOCUS,
  pointerHovers,
  stageFocus,
  type TimelineFocus,
  togglePhase,
  toggleStage,
  wholeRunLabel,
} from "@/lib/microcosm/timeline-focus";
import {
  orderRunOptions,
  parseRunOrder,
  RUN_ORDER_PARAM,
  type RunOrder,
  withRunOrder,
} from "@/lib/microcosm/run-order";
import {
  BUILD_PHASES,
  type BuildForecast,
  type BuildPhase,
  type BuildRunSource,
  type BuildRunState,
  type BuildTimeline,
  type SolverForecast,
  type SolverSegment,
  type StageForecast,
  formatStageName,
  phaseTotals,
  runDurationMs,
  sameStageSequence,
  solverPassLabel,
  solverSegments,
  stageCores,
  stageMemoryBytes,
  type StageSpan,
} from "@/lib/microcosm/build-monitor";
import {
  clockTime,
  runStartTime,
  type ViewerZone,
} from "@/lib/microcosm/viewer-time";

const BUILD_PHASE_LABEL = Object.fromEntries(BUILD_PHASES.map((phase) => [phase.id, phase.label])) as Record<
  BuildPhase,
  string
>;
export const PHASE_COLOR: Record<BuildPhase, string> = {
  setup: "var(--phase-setup)",
  checks: "var(--phase-checks)",
  compile: "var(--phase-compile)",
  calibrate: "var(--phase-calibrate)",
  export: "var(--phase-export)",
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
  // The US fiscal-refresh release refused a gates dry run before its stop point
  // (microcosm tools/build_us_fiscal_refresh_release.py).
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

// A time on the run overview, in the viewer's zone and named ("07:56 AM
// GMT+4").
function ClockTime({
  ms,
  nowMs,
  zone,
}: {
  ms: number | null | undefined;
  nowMs: number;
  zone: ViewerZone | null;
}) {
  if (ms == null || !Number.isFinite(ms)) return <>—</>;
  return (
    <ViewerTime ms={ms}>{clockTime(ms, nowMs, zone, { zoneName: true })}</ViewerTime>
  );
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
// stopped. The selector groups runs by pipeline or, ordered by date, puts the
// pipeline's name before this label (in `BuildMonitorView`); the overview
// shows the id. Its start is in the viewer's zone, which the page names above
// the selector.
export function runOptionLabel(
  run: BuildTimeline,
  nowMs: number,
  zone: ViewerZone | null,
): string {
  const started = run.started_ms ? runStartTime(run.started_ms, zone, { zoneName: true }) : "unknown start";
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

// How the run selector orders runs; the choice is kept in the URL.
function RunOrderToggle({ order, onChange }: { order: RunOrder; onChange: (order: RunOrder) => void }) {
  const options: { id: RunOrder; label: string; hint: string }[] = [
    { id: "pipeline", label: "By pipeline", hint: "Runs grouped by pipeline, newest first in each" },
    { id: "date", label: "By date", hint: "Every run in one list by start, newest first" },
  ];
  return (
    <div role="radiogroup" aria-label="Run order" className="inline-flex rounded-md border border-border p-0.5">
      {options.map((option) => {
        const active = option.id === order;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={`h-8 rounded px-3 text-sm font-medium transition-colors ${
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

// The Run selector's label for a run a link named that the list does not
// hold: the run's own label once its detail arrives, what went wrong when
// its detail failed, and never the ID from the URL, which may name no run at
// all.
export function linkedRunOptionLabel(
  selected: string,
  detailRun: BuildTimeline | undefined,
  nowMs: number,
  zone: ViewerZone | null,
  failure: "not_found" | "unavailable" | null = null,
): string {
  if (detailRun?.run_id === selected) return runOptionLabel(detailRun, nowMs, zone);
  if (failure === "not_found") return "Run not found";
  if (failure === "unavailable") return "Run unavailable";
  return "Loading run…";
}

// What the Run selector says went wrong with a linked run's detail, if
// anything. A run about to give way to the default run is still loading, and
// so is one not found before the run list arrives, as it gives way then.
export function linkedRunFailure({
  notFound,
  failed,
  replacing,
  listLoading,
}: {
  notFound: boolean;
  failed: boolean;
  replacing: boolean;
  listLoading: boolean;
}): "not_found" | "unavailable" | null {
  if (replacing || (notFound && listLoading)) return null;
  if (notFound) return "not_found";
  return failed ? "unavailable" : null;
}

// The Build progress tab of the Staging candidates page. `preferredRunId`
// is the run the page's URL names, chosen on either tab; a run picked here is
// reported back through `onRunChange` so the other tab opens on it.
export function BuildMonitorView({
  tabs,
  preferredRunId,
  onRunChange,
  localRunsEnabled,
}: {
  tabs?: ReactNode;
  preferredRunId?: string;
  onRunChange?: (runId: string) => void;
  // Whether the server names a local runs folder; never on the hosted
  // dashboard.
  localRunsEnabled: boolean;
}) {
  const [chosenSource, setChosenSource] = useState<BuildRunSource | null>(null);
  // With a local runs folder, the local listing answers first and says
  // whether this machine's runs are opened; hosted telemetry is read only
  // once it is the chosen source. Without one it is read at once.
  // A server started with a folder the prerendered page did not know of says
  // so in its answer to the hosted list.
  const [hostedListReportsLocalRuns, setHostedListReportsLocalRuns] = useState(false);
  const [hostedListFailed, setHostedListFailed] = useState(false);
  const local = useBuildRuns(
    "local",
    localListRequested(localRunsEnabled, hostedListReportsLocalRuns, hostedListFailed),
  );
  const localEnabled = local.data?.local_enabled ?? false;
  const localRuns = local.data?.runs ?? [];
  // Whether this machine's runs open by themselves: see `opensLocalRuns`. The
  // page's run (a link, or a choice on either tab) counts as the carried-over
  // run there.
  const preferLocal = opensLocalRuns(
    localRunsEnabled,
    localEnabled,
    localRuns.map((run) => run.run_id),
    preferredRunId,
  );
  const source: BuildRunSource = chosenSource ?? (preferLocal ? "local" : "staging");
  const staging = useBuildRuns("staging", hostedListRequested(localRunsEnabled, source, local.isLoading));
  useEffect(() => {
    if (staging.data?.local_enabled) setHostedListReportsLocalRuns(true);
  }, [staging.data?.local_enabled]);
  useEffect(() => {
    if (staging.isError) setHostedListFailed(true);
  }, [staging.isError]);
  const list = source === "local" ? local : staging;
  const runs = list.data?.runs ?? [];
  // A run the page's URL names is requested at once, beside the list.
  const [selected, setSelected] = useState(preferredRunId ?? "");
  // The page's run changed without a choice here, as with a link to the same
  // page or the browser's Back button: show it, or, when the URL no longer
  // names one, the default run.
  useEffect(() => {
    setSelected(preferredRunId ?? "");
  }, [preferredRunId]);
  // The order is read from the URL on every render, not copied once: a link
  // to the same page, or the browser's Back button, changes the URL while
  // this view stays mounted. Next.js updates `useSearchParams` after
  // `history.replaceState`, so writing the URL is enough to change it.
  const searchParams = useSearchParams();
  const runOrder = parseRunOrder(searchParams.get(RUN_ORDER_PARAM));
  const chooseRunOrder = (next: RunOrder) => {
    window.history.replaceState(null, "", withRunOrder(window.location.href, next));
  };
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

  const selectRun = (runId: string) => {
    setSelected(runId);
    onRunChange?.(runId);
  };

  const detail = useBuildRun(source, selected || undefined);
  // While a run that failed is asked for again, the previous run's detail
  // stands in as a placeholder; the tab shows it loading instead.
  const data = placeholderHidesFailure(detail.isPlaceholderData, detail.errorUpdateCount)
    ? undefined
    : detail.data;
  const runNotFound = detail.error instanceof ApiError && detail.error.status === 404;
  // The page's URL names the run shown: the default run is written there, and
  // a run no source holds gives way to the default run.
  useEffect(() => {
    const { runId, urlRunId } = buildRunToShow(runs, selected, preferredRunId, runNotFound);
    if (runId !== selected) setSelected(runId);
    if (urlRunId) onRunChange?.(urlRunId);
  }, [runs, selected, preferredRunId, runNotFound, onRunChange]);
  // A run that was not found is about to give way to the default run.
  const replacingRun = runNotFound && runs.some((run) => run.run_id !== selected);
  // The run list is asked for every five minutes and the run only while it
  // runs, so a run that went silent and came back shows as running in the
  // list first: ask for the run again, once per list answer.
  const listRunState = runs.find((run) => run.run_id === selected)?.state;
  const detailRunState = data?.run.run_id === selected ? data.run.state : undefined;
  useEffect(() => {
    if (detailBehindList(listRunState, detailRunState)) void detail.refetch();
    // Only a new list answer prompts this; the run's own answers do not.
  }, [list.dataUpdatedAt]);
  const nowMs = data?.now_ms ?? Date.now();
  const zone = useViewerZone();
  // A run a link named that the list does not hold, such as one older than
  // its runs, gets an option of its own, first in either order.
  const linkedRunOutsideList = Boolean(selected) && !runs.some((run) => run.run_id === selected);
  const runOptions = [
    ...(linkedRunOutsideList
      ? [
          {
            value: selected,
            label: linkedRunOptionLabel(
              selected,
              data?.run,
              nowMs,
              zone,
              linkedRunFailure({
                notFound: runNotFound,
                failed: Boolean(detail.error),
                replacing: replacingRun,
                // As for the wait for the run list below: with a local runs
                // folder, the hosted list waits for the local one.
                listLoading: list.isLoading || (localRunsEnabled && local.isLoading),
              }),
            ),
            group: "Linked run, not in this list",
          },
        ]
      : []),
    // The list's runs in the chosen order: under their pipeline groups, or by
    // start with each run naming its pipeline.
    ...orderRunOptions(runs, runOrder, (run) => runGroups.get(run.run_id)).map(({ run, group }) => {
      const label = runOptionLabel(run, list.data?.now_ms ?? Date.now(), zone);
      return {
        value: run.run_id,
        label: runOrder === "date" ? `${run.pipeline_label} · ${label}` : label,
        group,
      };
    }),
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Microcosm · staging"
        title="Staging candidates"
        status={tabs}
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
            <RunOrderToggle order={runOrder} onChange={chooseRunOrder} />
            <ToolbarSelect
              label="Run"
              value={selected}
              options={
                runOptions.length
                  ? runOptions
                  : [{ value: "", label: list.isLoading ? "Loading runs…" : "No runs" }]
              }
              onChange={selectRun}
              disabled={!runOptions.length}
              className="w-[30rem] max-w-full"
            />
          </div>
        }
      />

      {/* The local list's first load decides the source only when the page knew
          of a folder; a folder found later does not bring the loading back. */}
      {waitsForRunList(
        list.isLoading || (localRunsEnabled && local.isLoading),
        runs.length,
        selected,
        data != null,
      ) ? (
        <LoadingBlock label="Loading build runs…" />
      ) : list.error ? (
        <EmptyState title="Build runs unavailable" description={String(list.error.message)} />
      ) : list.data && !list.data.available ? (
        <EmptyState
          title={source === "local" ? "Local runs are off" : "Hosted runs unavailable"}
          description={list.data.detail ?? undefined}
        />
      ) : !runs.length && !(selected && (data || runDetailLoading(detail, false))) ? (
        <EmptyState
          title="No build runs found"
          description={
            source === "local"
              ? `No run folders (progress.json and events.ndjson) under ${list.data?.roots.join(", ") || "the configured directory"}.`
              : "The collector and historical staging repository have no runs for this country."
          }
        />
      ) : runDetailLoading(detail, data != null) || replacingRun ? (
        <LoadingBlock label="Loading run…" />
      ) : detail.error ? (
        <EmptyState
          title={runNotFound ? "Run not found" : "Run unavailable"}
          description={
            runNotFound
              ? `${detail.error.message} ${
                  source === "local"
                    ? "No run folder on this machine has this ID."
                    : "No hosted run with this ID is recorded for this country."
                } Choose another run from the Run list.`
              : String(detail.error.message)
          }
        />
      ) : data ? (
        <>
          <StaleSourceNotice runs={runs} source={source} nowMs={nowMs} />
          <RunOverview run={data.run} forecast={data.forecast} nowMs={nowMs} zone={zone} />
          <TimelineCard run={data.run} forecast={data.forecast} nowMs={nowMs} />
          {list.data?.problems.length ? (
            <SectionCard title="Runs that could not be read">
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

export function RunOverview({
  run,
  forecast,
  nowMs,
  zone,
}: {
  run: BuildTimeline;
  forecast: BuildForecast | null;
  nowMs: number;
  zone: ViewerZone | null;
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
      description={
        <>
          Started <ClockTime ms={run.started_ms} nowMs={nowMs} zone={zone} />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Elapsed" value={fmtDuration(elapsed)} size="sm" />
          {running ? (
            <KpiCard
              label="Expected finish"
              value={
                forecast?.finish_p50_ms ? (
                  <ClockTime ms={forecast.finish_p50_ms} nowMs={nowMs} zone={zone} />
                ) : (
                  "Unknown"
                )
              }
              hint={
                forecast?.finish_p90_ms ? (
                  <>
                    90% by <ClockTime ms={forecast.finish_p90_ms} nowMs={nowMs} zone={zone} />
                  </>
                ) : (
                  "No comparable finished runs"
                )
              }
              size="sm"
            />
          ) : (
            <KpiCard
              label={run.state === "stalled" ? "Last telemetry" : "Finished"}
              value={<ClockTime ms={run.ended_ms ?? run.updated_ms} nowMs={nowMs} zone={zone} />}
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
            The last telemetry came {fmtDuration(elapsed)} after the run started,{" "}
            {silentFor != null && silentFor > 24 * 3_600_000 ? (
              <>
                on <ClockTime ms={run.updated_ms} nowMs={nowMs} zone={zone} />
              </>
            ) : (
              `${fmtDuration(silentFor)} ago`
            )}
            , and the run wrote no final event. The telemetry does not say why it stopped, or whether the process is
            still working without reporting.
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
  // The key of the stage the row belongs to: its own for a stage, its
  // stage's for a solver pass.
  stageKey: string;
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
      stageKey: row.key,
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
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<ReadonlySet<BuildPhase>>(NO_FOCUS.filter);
  const [hoveredPhase, setHoveredPhase] = useState<BuildPhase | null>(null);
  const [selected, setSelected] = useState<{ stageKey: string; phase: BuildPhase } | null>(null);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  // Another run starts with nothing filtered or selected; the breakdown stays
  // open or closed.
  useEffect(() => {
    setFilter(NO_FOCUS.filter);
    setHoveredPhase(null);
    setSelected(null);
    setHoveredStage(null);
  }, [run.run_id]);
  return (
    <TimelineView
      run={run}
      forecast={forecast}
      nowMs={nowMs}
      expanded={expanded}
      focus={{
        filter,
        hoveredPhase,
        selectedStage: selected?.stageKey ?? null,
        selectedPhase: selected?.phase ?? null,
        hoveredStage,
      }}
      // A row that closes or is filtered out under the pointer never reports
      // the pointer leaving it.
      onToggleExpanded={() => {
        setExpanded((open) => !open);
        setHoveredStage(null);
      }}
      onHoverPhase={setHoveredPhase}
      onTogglePhase={(phase) => {
        setFilter((current) => togglePhase(current, phase));
        setHoveredStage(null);
      }}
      onHoverStage={setHoveredStage}
      onToggleStage={(stageKey, phase) =>
        setSelected((current) => {
          const next = toggleStage(current?.stageKey ?? null, stageKey);
          return next ? { stageKey: next, phase } : null;
        })
      }
    />
  );
}

export interface TimelineViewProps {
  run: BuildTimeline;
  forecast: BuildForecast | null;
  nowMs: number;
  // Whether the per-stage breakdown is open.
  expanded: boolean;
  focus: TimelineFocus;
  onToggleExpanded: () => void;
  onHoverPhase: (phase: BuildPhase | null) => void;
  onTogglePhase: (phase: BuildPhase) => void;
  onToggleStage: (stageKey: string, phase: BuildPhase) => void;
  onHoverStage: (stageKey: string | null) => void;
}

// A dimmed stage's opacity, while another stage type is hovered or another
// stage is selected.
const DIMMED_OPACITY = 0.25;

// The Timeline card's drawing, given what is open and focused; the card keeps
// that state.
export function TimelineView({
  run,
  forecast,
  nowMs,
  expanded,
  focus,
  onToggleExpanded,
  onHoverPhase,
  onTogglePhase,
  onToggleStage,
  onHoverStage,
}: TimelineViewProps) {
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
    stageKey: `${stage.stage}-${index}`,
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
  // Under a stage-type filter the picked types' stages are laid end to end
  // and fill the bar, so the axis counts time in those types, not time since
  // the start; the forecast band and the present are left off it.
  const filtered = focus.filter.size > 0;
  const extents = rows.map((row) => ({ key: row.stageKey, phase: row.phase, start: row.start, end: row.end }));
  const axis = filtered ? filteredAxis(extents, focus.filter) : null;
  const stageStart = new Map(rows.map((row) => [row.stageKey, row.start]));
  // Where a row sits on the bar's axis; null when the filter hides it.
  const place = (row: TimelineRow): { start: number; end: number } | null => {
    if (!axis) return { start: row.start, end: row.end };
    const base = axis.starts.get(row.stageKey);
    if (base == null) return null;
    const start = base + (row.start - (stageStart.get(row.stageKey) ?? row.start));
    return { start, end: start + (row.end - row.start) };
  };
  const domain = axis
    ? Math.max(1, axis.length)
    : Math.max(1, elapsed, p90Offset ?? 0, ...rows.map((row) => row.end)) * 1.02;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / domain) * 100))}%`;
  const width = (start: number, end: number) => `${Math.max(0.25, ((end - start) / domain) * 100)}%`;
  // Every stage gets a row, however short: a seconds-long stage is still a
  // step the build went through. A stage that ran the solver is followed by
  // its passes and the stretches between them.
  const visible = rows
    .flatMap((row) => (run.started_ms == null ? [row] : [row, ...solverRows(row, run, run.started_ms, elapsed)]))
    .filter((row) => place(row) != null);
  const ticks = axisTicks(domain);

  if (!rows.length) {
    return (
      <SectionCard title="Timeline">
        <EmptyState title="No stage events yet." variant="compact" />
      </SectionCard>
    );
  }
  const totals = phaseTotals(run, nowMs).phases;
  const focusOf = (row: TimelineRow) => stageFocus(focus, row.phase, row.stageKey);

  const barStyle = (row: TimelineRow): CSSProperties => {
    const onAxis = place(row) ?? { start: row.start, end: row.end };
    const placement = {
      left: pct(onAxis.start),
      width: width(onAxis.start, onAxis.end),
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
        ...placement,
        backgroundImage: `${RUNNING_STRIPES}, linear-gradient(to right, ${color} ${done}%, color-mix(in srgb, ${color} 35%, transparent) ${done}%)`,
        backgroundSize: "16px 16px, 100% 100%",
      };
    }
    return {
      ...placement,
      background:
        row.status === "pending" ? PENDING_FILL : row.status === "failed" ? FAILED_COLOR : PHASE_COLOR[row.phase],
    };
  };

  return (
    <SectionCard title="Timeline">
      <div className="flex flex-col gap-1">
        {/* Below md the stage names keep 8rem so the bar track gets the rest of
            a phone's width instead of what is left after a 14rem name column. */}
        <div className="mt-2 grid grid-cols-[minmax(8rem,14rem)_1fr] gap-x-3 gap-y-1 text-xs max-md:grid-cols-[8rem_1fr]">
          <div className="flex min-w-0 items-center gap-1 font-medium text-muted-foreground">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide the stages" : "Show the stages"}
              onClick={onToggleExpanded}
              className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
            >
              <ChevronRight
                aria-hidden="true"
                className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </button>
            <span className="truncate">{wholeRunLabel(focus.filter)}</span>
          </div>
          <div ref={measureArea} className="relative h-6 rounded bg-muted/40">
            {rows.map((row) => {
              const { visible, dimmed } = focusOf(row);
              if (!visible) return null;
              return (
                <div
                  key={`whole-${row.key}`}
                  className={`absolute top-0 h-full transition-opacity ${row.status === "running" ? "bar-running" : ""}`}
                  style={{ ...barStyle(row), opacity: dimmed ? DIMMED_OPACITY : 1 }}
                  title={`${row.label}: ${fmtDuration(row.end - row.start)}`}
                />
              );
            })}
            {!filtered && p50Offset != null && p90Offset != null ? (
              <div
                className="absolute -top-1 h-8 border-x border-dashed border-foreground/40 bg-foreground/5"
                style={{ left: pct(p50Offset), width: width(p50Offset, p90Offset) }}
                title={`Finish between ${fmtDuration(p50Offset)} and ${fmtDuration(p90Offset)} after start`}
              />
            ) : null}
            {!filtered && run.state === "running" ? <NowLine left={pct(elapsed)} /> : null}
          </div>

          {expanded
            ? visible.map((row) => {
                const onAxis = place(row) ?? { start: row.start, end: row.end };
                return (
                  <TimelineStageRow
                    key={row.key}
                    row={row}
                    barStyle={barStyle(row)}
                    dimmed={focusOf(row).dimmed}
                    selected={focus.selectedStage === row.stageKey}
                    onSelect={() => onToggleStage(row.stageKey, row.phase)}
                    onHover={(hovering) => onHoverStage(hovering ? row.stageKey : null)}
                    nowLeft={!filtered && run.state === "running" ? pct(elapsed) : null}
                    nowOffset={run.state === "running" ? elapsed : null}
                    areaWidth={areaWidth}
                    startFraction={Math.min(1, onAxis.start / domain)}
                    endFraction={Math.min(1, Math.max(onAxis.end, onAxis.start + 0.0025 * domain) / domain)}
                  />
                );
              })
            : null}

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
          <PhaseLegend
            order={phasesByFirstAppearance(extents)}
            totals={totals}
            focus={focus}
            onHoverPhase={onHoverPhase}
            onTogglePhase={onTogglePhase}
          />
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
  dimmed,
  selected,
  onSelect,
  onHover,
  nowLeft,
  nowOffset,
  areaWidth,
  startFraction,
  endFraction,
}: {
  row: TimelineRow;
  barStyle: CSSProperties;
  // Drawn faint while another stage type is hovered or another stage is
  // selected.
  dimmed: boolean;
  // This stage is the one selected; clicking its name selects it or clears
  // the selection.
  selected: boolean;
  onSelect: () => void;
  // The pointer, or keyboard focus, entering (true) or leaving (false) the row.
  onHover: (hovering: boolean) => void;
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
  const rowBarStyle = dimmed ? { ...barStyle, opacity: DIMMED_OPACITY } : barStyle;
  return (
    <>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        onPointerEnter={(event) => {
          if (pointerHovers(event.pointerType)) onHover(true);
        }}
        onPointerLeave={() => onHover(false)}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) onHover(true);
        }}
        onBlur={() => onHover(false)}
        className={`flex min-w-0 items-center gap-1.5 rounded text-left hover:bg-muted/60 ${
          selected && !row.segment ? "bg-muted font-medium" : ""
        } ${row.segment ? "pl-3.5 text-muted-foreground" : ""}`}
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
      </button>
      {/* Labels that do not fit are clipped; the tooltip has the full text. */}
      <div
        className="relative h-5 overflow-hidden"
        title={`${row.label}: ${full}`}
        onPointerEnter={(event) => {
          if (pointerHovers(event.pointerType)) onHover(true);
        }}
        onPointerLeave={() => onHover(false)}
      >
        <div
          className={`absolute top-0.5 h-4 rounded-sm transition-opacity ${running ? "bar-running" : ""}`}
          style={rowBarStyle}
        />
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

// The stage types, each a button: hovering one shows its total time in the
// run and dims the other types; clicking adds it to, or removes it from, the
// Whole run filter. Failed and expected stages are drawn apart from type.
function PhaseLegend({
  order,
  totals,
  focus,
  onHoverPhase,
  onTogglePhase,
}: {
  // The stage types in the order the build first reached them.
  order: BuildPhase[];
  totals: Record<BuildPhase, number>;
  focus: TimelineFocus;
  onHoverPhase: (phase: BuildPhase | null) => void;
  onTogglePhase: (phase: BuildPhase) => void;
}) {
  const tooltipIdPrefix = useId();
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {order.map((id) => {
        const phase = { id, label: BUILD_PHASE_LABEL[id] };
        const picked = focus.filter.has(phase.id);
        const hovered = focus.hoveredPhase === phase.id;
        const tooltipId = `${tooltipIdPrefix}-${phase.id}`;
        return (
          <span key={phase.id} className="relative">
            <button
              type="button"
              aria-pressed={picked}
              aria-describedby={hovered ? tooltipId : undefined}
              onClick={() => onTogglePhase(phase.id)}
              // A mouse or pen, or keyboard focus, opens the hover card; a
              // tap, or the focus a click leaves behind, does not.
              onPointerEnter={(event) => {
                if (pointerHovers(event.pointerType)) onHoverPhase(phase.id);
              }}
              onPointerLeave={() => onHoverPhase(null)}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) onHoverPhase(phase.id);
              }}
              onBlur={() => onHoverPhase(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onHoverPhase(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 ${
                picked ? "border-border-strong bg-muted font-medium text-foreground" : "border-transparent hover:bg-muted/60"
              }`}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: PHASE_COLOR[phase.id] }} />
              {phase.label}
            </button>
            {hovered ? (
              <span
                id={tooltipId}
                role="tooltip"
                className="absolute bottom-full left-0 z-10 mb-1 flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-foreground shadow-[var(--elev-1)]"
              >
                <span className="font-medium">{phase.label}</span>
                <span className="tabular-nums">{fmtDuration(totals[phase.id])}</span>
              </span>
            ) : null}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: FAILED_COLOR }} />
        Failed
      </span>
      <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: PENDING_FILL }} />
        Expected
      </span>
    </div>
  );
}

