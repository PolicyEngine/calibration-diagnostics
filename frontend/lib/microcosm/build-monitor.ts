// Build monitor model. Turns Microcosm staging telemetry — a local run folder
// or a run in the Hugging Face staging repository — into stage spans, a
// completion forecast from comparable past runs, and cross-run timing and
// gate statistics.
//
// Both telemetry schemas are supported:
// - version 1 (US fiscal-refresh release): every event is a transition into a
//   stage, so a stage lasts until the next event. Passing gates are silent;
//   failing gates emit a `failed` transition, and `telemetry.fail` appends a
//   terminal `failed` stage carrying the error.
// - version 2 (UK): explicit `started` / `completed` / `failed` events that
//   nest, plus `calibration` events that are progress, not stages.

type JsonObject = Record<string, unknown>;

export type BuildRunSource = "local" | "staging";
// `blocked`: the process ran to the end but its gates refused the candidate.
// UK builds close such runs as `completed` (microcosm full_build_cli), so the
// monitor reads the gate counts to tell them apart.
export type BuildRunState = "running" | "passed" | "blocked" | "failed" | "stalled";
export type BuildPhase = "setup" | "checks" | "compile" | "calibrate" | "export";

export const BUILD_PHASES: { id: BuildPhase; label: string }[] = [
  { id: "setup", label: "Setup & inputs" },
  { id: "checks", label: "Checks & gates" },
  { id: "compile", label: "Target compilation" },
  { id: "calibrate", label: "Calibration" },
  { id: "export", label: "Export & diagnostics" },
];

// A run with no telemetry for this long is reported as stalled. Matches the
// staging page; a killed process (OOM, jetsam) never writes a terminal event.
export const STALL_MS = 6 * 60 * 60 * 1000;
// A run that sends heartbeats (every 60 s) is stalled once five are missed:
// the process was most likely killed (out of memory, SIGKILL).
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
const HISTORY_LIMIT = 12;
const MARKER_STAGES = new Set(["created", "complete", "failed"]);
const GATE_PATTERN =
  /(^|_)(gate|gates|check|checks|validation|composition|presence|smoke|audit|evaluation)(_|$)/;

export interface BuildRunDocuments {
  run_id: string;
  source: BuildRunSource;
  country: string;
  progress: JsonObject | null;
  run_manifest: JsonObject | null;
  calibration_progress: JsonObject | null;
  events: JsonObject[];
}

export interface StageSpan {
  stage: string;
  depth: number;
  start_ms: number;
  // null while the stage is still running.
  end_ms: number | null;
  status: "running" | "completed" | "failed";
  message: string | null;
  failures: string[];
  phase: BuildPhase;
  is_gate: boolean;
  // A gate battery that completed but refused the candidate.
  refused: boolean;
  // Work-unit progress the stage reports while it runs (batches, chunks).
  progress: StageProgressPoint[];
  // Batches done of the stage's total, with the time they took, from the
  // run's progress document while the stage runs.
  work: StageWork | null;
  // Process resources when the stage started and ended (or the latest
  // heartbeat while it runs).
  resources_start: ResourceSnapshot | null;
  resources_end: ResourceSnapshot | null;
}

// CPU seconds the process has used so far (user and system, finished child
// processes included) and its memory, as a run reports them.
export interface ResourceSnapshot {
  time_ms: number;
  cpu_seconds: number | null;
  rss_bytes: number | null;
  peak_rss_bytes: number | null;
}

export interface StageWork {
  done: number;
  total: number;
  unit: string | null;
  elapsed_seconds: number;
  updated_ms: number;
  details: JsonObject;
}

// What produced a run, from its run manifest.
export interface RunIdentity {
  git_commit: string | null;
  platform: string | null;
  cpu_count: number | null;
  memory_bytes: number | null;
  runtime: Record<string, string>;
}

export interface StageProgressPoint {
  done: number;
  total: number;
  time_ms: number;
}

export interface CalibrationPoint {
  epoch: number | null;
  epochs: number | null;
  loss: number | null;
  time_ms: number;
  // Solver passes restart the epoch counter (size search, refits).
  pass: number;
  phase: string | null;
}

export interface BuildFailure {
  stage: string | null;
  message: string | null;
  error_type: string | null;
  // gate_refused, terminated, interrupted, out_of_memory, refused or error,
  // as the run recorded it; null when it recorded none.
  failure_class: string | null;
}

export interface BuildTimeline {
  run_id: string;
  source: BuildRunSource;
  country: string;
  pipeline: string;
  pipeline_label: string;
  schema_version: 1 | 2;
  state: BuildRunState;
  started_ms: number | null;
  updated_ms: number | null;
  ended_ms: number | null;
  current_stage: string | null;
  failure: BuildFailure | null;
  spans: StageSpan[];
  calibration: CalibrationPoint[];
  heartbeat_ms: number | null;
  // The latest resources the run reported.
  resources: ResourceSnapshot | null;
  identity: RunIdentity | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function timeMs(value: unknown): number | null {
  const text = str(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function isGateStage(stage: string): boolean {
  return GATE_PATTERN.test(stage);
}

export function stagePhase(stage: string): BuildPhase {
  if (isGateStage(stage)) return "checks";
  if (/compil|materializ|target_registry|surface_resolution|measure_resolution/.test(stage)) {
    return "compile";
  }
  if (/calibrat|solver|size_search|refit|holdout/.test(stage)) return "calibrate";
  if (
    /export|h5|staging|upload|manifest|record|npz|publish|demographic|coverage|reform_validation|participation|diagnostic/.test(
      stage,
    )
  ) {
    return "export";
  }
  return "setup";
}

// Source and program abbreviations that appear in stage and pipeline ids.
const ACRONYMS = new Set([
  "aca", "acs", "ald", "am", "be", "cd", "chip", "cps", "ctc", "ecps", "eitc", "etb", "frs",
  "h5", "hmrc", "jct", "l0", "lcfs", "meps", "npz", "nts", "oa", "ons", "org", "puf", "qbi",
  "qrf", "salt", "scf", "sipp", "snap", "soi", "spi", "spm", "ssi", "tanf", "uc", "uk", "us",
  "vat", "was", "wic",
]);

export function formatStageName(stage: string): string {
  const words = stage.replace(/[_-]+/g, " ").trim().split(/\s+/);
  const text = words
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word))
    .join(" ");
  return text ? text[0].toUpperCase() + text.slice(1) : stage;
}

function pipelineIdentity(
  documents: BuildRunDocuments,
  schemaVersion: 1 | 2,
): { key: string; label: string } {
  const identity = documents.progress ?? documents.run_manifest;
  const pipeline = obj(identity?.pipeline);
  const pipelineId = str(pipeline?.id);
  const country = str(identity?.country_code) ?? documents.country.toUpperCase();
  if (schemaVersion === 2 && pipelineId) {
    // A smoke run on a synthetic fixture is not comparable with a full run of
    // the same pipeline, so the run kind is part of the key.
    const kind = str(identity?.run_kind);
    const smoke = kind === "smoke";
    return {
      key: `${country}:${pipelineId}${smoke ? ":smoke" : ""}`,
      label: `${formatStageName(pipelineId)}${smoke ? " (smoke)" : ""}`,
    };
  }
  return {
    key: `${country}:release-v1`,
    label: `${country} release build`,
  };
}

function runState(
  rawStatus: string | null,
  updatedMs: number | null,
  nowMs: number,
  stallMs: number = STALL_MS,
): BuildRunState {
  if (rawStatus === "passed" || rawStatus === "completed" || rawStatus === "published") {
    return "passed";
  }
  if (rawStatus === "failed") return "failed";
  if (updatedMs != null && nowMs - updatedMs > stallMs) return "stalled";
  return "running";
}

function resourceSnapshot(value: unknown, at: number | null): ResourceSnapshot | null {
  const resources = obj(value);
  if (!resources || at == null) return null;
  const user = num(resources.cpu_user_seconds);
  const system = num(resources.cpu_system_seconds);
  return {
    time_ms: at,
    cpu_seconds: user == null && system == null ? null : (user ?? 0) + (system ?? 0),
    rss_bytes: num(resources.rss_bytes),
    peak_rss_bytes: num(resources.peak_rss_bytes),
  };
}

function stageWork(value: unknown): (StageWork & { stage: string | null }) | null {
  const work = obj(value);
  const done = num(work?.done);
  const total = num(work?.total);
  const elapsed = num(work?.elapsed_seconds);
  const updated = timeMs(work?.updated_at);
  if (done == null || total == null || elapsed == null || updated == null) return null;
  return {
    stage: str(work?.stage),
    done,
    total,
    unit: str(work?.unit),
    elapsed_seconds: elapsed,
    updated_ms: updated,
    details: obj(work?.details) ?? {},
  };
}

function runIdentity(manifest: JsonObject | null): RunIdentity | null {
  const identity = obj(manifest?.identity);
  if (!identity) return null;
  const host = obj(identity.host);
  const runtime = obj(identity.runtime) ?? {};
  return {
    git_commit: str(identity.git_commit),
    platform: str(host?.platform),
    cpu_count: num(host?.cpu_count),
    memory_bytes: num(host?.memory_bytes),
    runtime: Object.fromEntries(
      Object.entries(runtime).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

function eventTime(event: JsonObject): number | null {
  return timeMs(event.time) ?? timeMs(event.timestamp);
}

function eventStage(event: JsonObject): string | null {
  return str(event.stage) ?? str(event.stage_id);
}

function newSpan(
  stage: string,
  depth: number,
  startMs: number,
  event: JsonObject,
): StageSpan {
  return {
    stage,
    depth,
    start_ms: startMs,
    end_ms: null,
    status: "running",
    message: str(event.message),
    failures: [],
    phase: stagePhase(stage),
    is_gate: isGateStage(stage),
    refused: false,
    progress: [],
    work: null,
    resources_start: resourceSnapshot(event.resources, startMs),
    resources_end: null,
  };
}

// A stage can report how far through its work it is, as any of these
// (done, total) detail pairs. The newest samples are kept.
const PROGRESS_KEYS: [string, string][] = [
  ["done", "total"],
  ["completed", "total"],
  ["batch", "batches"],
  ["chunk", "chunks"],
  ["step", "steps"],
];
const PROGRESS_SAMPLE_LIMIT = 60;

function recordProgress(span: StageSpan, event: JsonObject, time: number) {
  const details = obj(event.details);
  if (!details) return;
  for (const [doneKey, totalKey] of PROGRESS_KEYS) {
    const done = num(details[doneKey]);
    const total = num(details[totalKey]);
    if (done == null || total == null || total <= 0) continue;
    span.progress.push({ done, total, time_ms: time });
    if (span.progress.length > PROGRESS_SAMPLE_LIMIT) span.progress.shift();
    return;
  }
}

function markFailed(span: StageSpan, event: JsonObject) {
  const details = obj(event.details);
  span.status = "failed";
  span.message = str(event.message) ?? span.message;
  span.failures.push(...stringList(details?.failures));
  const error = str(details?.error);
  if (error) span.failures.push(error);
}

// Version 1: each event is a transition into `stage`.
function spansFromTransitions(events: JsonObject[]): {
  spans: StageSpan[];
  terminal: { stage: string; event: JsonObject; time: number } | null;
} {
  const spans: StageSpan[] = [];
  let current: StageSpan | null = null;
  let terminal: { stage: string; event: JsonObject; time: number } | null = null;
  for (const event of events) {
    const stage = eventStage(event);
    const time = eventTime(event);
    if (!stage || time == null) continue;
    if (stage === "created") continue;
    if (stage === "complete" || stage === "failed") {
      if (current) {
        current.end_ms = time;
        current.resources_end = resourceSnapshot(event.resources, time);
        if (stage === "failed") markFailed(current, event);
        else if (current.status === "running") current.status = "completed";
      }
      terminal = { stage, event, time };
      current = null;
      continue;
    }
    if (current && current.stage === stage) {
      if (str(event.status) === "failed") markFailed(current, event);
      recordProgress(current, event, time);
      continue;
    }
    if (current) {
      current.end_ms = time;
      current.resources_end = resourceSnapshot(event.resources, time);
      if (current.status === "running") current.status = "completed";
    }
    current = newSpan(stage, 0, time, event);
    if (str(event.status) === "failed") markFailed(current, event);
    recordProgress(current, event, time);
    spans.push(current);
  }
  return { spans, terminal };
}

// Version 2: explicit, nestable started/completed/failed events.
function spansFromLifecycle(events: JsonObject[]): {
  spans: StageSpan[];
  terminal: { stage: string; event: JsonObject; time: number } | null;
} {
  const spans: StageSpan[] = [];
  const open: StageSpan[] = [];
  let terminal: { stage: string; event: JsonObject; time: number } | null = null;
  for (const event of events) {
    if (str(event.event_type) === "calibration") continue;
    const status = str(event.status);
    const stage = eventStage(event);
    const time = eventTime(event);
    if (!stage || time == null) continue;
    if (status === "progress") {
      const span = [...open].reverse().find((candidate) => candidate.stage === stage);
      if (span) recordProgress(span, event, time);
      continue;
    }
    if (MARKER_STAGES.has(stage)) {
      if (stage !== "created") terminal = { stage, event, time };
      continue;
    }
    if (status === "started") {
      const span = newSpan(stage, open.length, time, event);
      spans.push(span);
      open.push(span);
      continue;
    }
    let index = -1;
    for (let i = open.length - 1; i >= 0; i -= 1) {
      if (open[i].stage === stage) {
        index = i;
        break;
      }
    }
    // A completion without a start is an instantaneous stage.
    const span =
      index >= 0 ? open.splice(index, 1)[0] : newSpan(stage, open.length, time, event);
    if (index < 0) spans.push(span);
    span.end_ms = time;
    if (status === "failed") markFailed(span, event);
    else span.status = "completed";
    const details = obj(event.details);
    const blocking = num(details?.blocking_failure_count);
    if (blocking) {
      span.status = "failed";
      span.refused = true;
      span.message = span.message ?? `${blocking} blocking gate failures`;
      const statuses = obj(details?.gate_statuses);
      const refused = statuses
        ? Object.entries(statuses)
            .filter(([, value]) => typeof value === "string" && !/^(pass|passed|ok|skipped|not_applicable)$/.test(value))
            .map(([gate, value]) => `${gate}: ${value}`)
        : [];
      span.failures.push(...(refused.length ? refused : [`${blocking} blocking failures`]));
    }
  }
  return { spans, terminal };
}

function calibrationPoints(
  calibrationProgress: JsonObject | null,
  progress: JsonObject | null,
): CalibrationPoint[] {
  const rows = Array.isArray(calibrationProgress?.events)
    ? (calibrationProgress!.events as unknown[])
    : [];
  const points: CalibrationPoint[] = [];
  let pass = 0;
  let previousEpoch: number | null = null;
  let previousTotal: number | null = null;
  for (const raw of rows) {
    const row = obj(raw);
    if (!row) continue;
    const time = timeMs(row.time) ?? timeMs(row.timestamp);
    if (time == null) continue;
    const epoch = num(row.epoch);
    const epochs = num(row.epochs);
    if (
      points.length &&
      ((epoch != null && previousEpoch != null && epoch < previousEpoch) ||
        (epochs != null && previousTotal != null && epochs !== previousTotal))
    ) {
      pass += 1;
    }
    previousEpoch = epoch;
    previousTotal = epochs;
    points.push({
      epoch,
      epochs,
      loss: num(row.loss),
      time_ms: time,
      pass,
      phase: str(row.phase),
    });
  }
  // Version 1 progress carries the latest epoch even when the calibration
  // file has not been written yet.
  const latest = obj(progress?.calibration);
  if (!points.length && latest) {
    const time = timeMs(latest.time);
    if (time != null) {
      points.push({
        epoch: num(latest.epoch),
        epochs: num(latest.epochs),
        loss: num(latest.loss),
        time_ms: time,
        pass: 0,
        phase: null,
      });
    }
  }
  return points;
}

export function buildTimeline(
  documents: BuildRunDocuments,
  nowMs: number = Date.now(),
): BuildTimeline {
  const progress = documents.progress;
  const identity = progress ?? documents.run_manifest;
  const schemaVersion: 1 | 2 = identity?.schema_version === 2 ? 2 : 1;
  const events = [...documents.events].sort((a, b) => {
    const seq = (num(a.sequence) ?? 0) - (num(b.sequence) ?? 0);
    return seq || (eventTime(a) ?? 0) - (eventTime(b) ?? 0);
  });
  const { spans, terminal } =
    schemaVersion === 2 ? spansFromLifecycle(events) : spansFromTransitions(events);

  const eventTimes = events.map(eventTime).filter((t): t is number => t != null);
  const calibration = calibrationPoints(documents.calibration_progress, progress);
  const startedMs =
    timeMs(identity?.started_at) ?? (eventTimes.length ? Math.min(...eventTimes) : null);
  const heartbeatMs = timeMs(progress?.heartbeat_at);
  const work = stageWork(progress?.work);
  const updatedCandidates = [
    timeMs(progress?.updated_at),
    heartbeatMs,
    work?.updated_ms ?? null,
    eventTimes.length ? Math.max(...eventTimes) : null,
    calibration.length ? calibration[calibration.length - 1].time_ms : null,
  ].filter((t): t is number => t != null);
  const updatedMs = updatedCandidates.length ? Math.max(...updatedCandidates) : null;
  const latestResources = resourceSnapshot(
    progress?.resources,
    heartbeatMs ?? timeMs(progress?.updated_at),
  );

  const rawStatus = str(progress?.status) ?? str(documents.run_manifest?.status);
  let state = runState(
    rawStatus,
    updatedMs,
    nowMs,
    heartbeatMs != null ? HEARTBEAT_STALE_MS : STALL_MS,
  );
  if (state === "running" && terminal?.stage === "failed") state = "failed";
  if (state === "running" && terminal?.stage === "complete") state = "passed";
  if (state === "passed" && spans.some((span) => span.refused)) {
    state = "blocked";
  }
  const finished = state === "passed" || state === "blocked" || state === "failed";
  const endedMs = finished ? (terminal?.time ?? updatedMs) : null;

  // Close what is still open: a finished run ends its open stages at the end
  // of the run; a stalled run ends them at its last sign of life.
  const closeAt = finished ? endedMs : state === "stalled" ? updatedMs : null;
  // The open stage's latest resources and work come from the progress
  // document (heartbeat and work reports).
  const openTopSpan = spans.find((span) => span.depth === 0 && span.end_ms == null) ?? null;
  if (openTopSpan && latestResources && latestResources.time_ms >= openTopSpan.start_ms) {
    openTopSpan.resources_end = openTopSpan.resources_end ?? latestResources;
  }
  if (state === "running" && openTopSpan && work && work.stage === openTopSpan.stage) {
    const { stage: _stage, ...stageWorkValue } = work;
    openTopSpan.work = stageWorkValue;
  }
  if (closeAt != null) {
    const openSpans = spans.filter((span) => span.end_ms == null);
    for (const span of openSpans) {
      span.end_ms = Math.max(closeAt, span.start_ms);
      if (span.status === "running") span.status = "completed";
    }
    if (state === "failed" && openSpans.length) {
      const innermost = openSpans.reduce((a, b) => (b.depth >= a.depth ? b : a));
      innermost.status = "failed";
    }
  }

  let failure: BuildFailure | null = null;
  if (state === "blocked") {
    const gate = spans.find((span) => span.refused)!;
    failure = {
      stage: gate.stage,
      message: `The run finished, but its gates refused the candidate (${gate.message ?? "blocking failures"}).`,
      error_type: null,
      failure_class: "gate_refused",
    };
  } else if (state === "failed") {
    const v2Failure = obj(progress?.failure);
    const failedSpan = [...spans].reverse().find((span) => span.status === "failed") ?? null;
    const terminalDetails = obj(terminal?.event.details);
    failure = {
      stage: failedSpan?.stage ?? null,
      message:
        str(v2Failure?.message) ??
        (terminal?.stage === "failed" ? str(terminal.event.message) : null) ??
        failedSpan?.message ??
        str(progress?.message),
      error_type: str(v2Failure?.error_type) ?? str(terminalDetails?.error_type),
      failure_class: str(terminalDetails?.failure_class),
    };
  }

  const openTop = spans.find((span) => span.depth === 0 && span.end_ms == null);
  const pipeline = pipelineIdentity(documents, schemaVersion);
  return {
    run_id: documents.run_id,
    source: documents.source,
    country: documents.country,
    pipeline: pipeline.key,
    pipeline_label: pipeline.label,
    schema_version: schemaVersion,
    state,
    started_ms: startedMs,
    updated_ms: updatedMs,
    ended_ms: endedMs,
    current_stage:
      openTop?.stage ?? str(progress?.current_stage) ?? str(progress?.stage) ?? null,
    failure,
    spans,
    calibration,
    heartbeat_ms: heartbeatMs,
    resources: latestResources,
    identity: runIdentity(documents.run_manifest),
  };
}

// Cores a stage kept busy on average: CPU seconds over wall seconds.
export function stageCores(span: StageSpan): number | null {
  const start = span.resources_start;
  const end = span.resources_end;
  if (start?.cpu_seconds == null || end?.cpu_seconds == null) return null;
  const wall = (end.time_ms - start.time_ms) / 1000;
  if (wall < 1) return null;
  return Math.max(0, end.cpu_seconds - start.cpu_seconds) / wall;
}

// Largest resident memory seen at the stage's start or end.
export function stageMemoryBytes(span: StageSpan): number | null {
  const values = [span.resources_start?.rss_bytes, span.resources_end?.rss_bytes].filter(
    (value): value is number => value != null,
  );
  return values.length ? Math.max(...values) : null;
}

export function topLevelSpans(timeline: BuildTimeline): StageSpan[] {
  return timeline.spans.filter((span) => span.depth === 0);
}

export function spanDurationMs(span: StageSpan, nowMs: number): number {
  return Math.max(0, (span.end_ms ?? nowMs) - span.start_ms);
}

export function runDurationMs(timeline: BuildTimeline, nowMs: number): number | null {
  if (timeline.started_ms == null) return null;
  const end =
    timeline.ended_ms ?? (timeline.state === "stalled" ? timeline.updated_ms : nowMs);
  return end == null ? null : Math.max(0, end - timeline.started_ms);
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export interface StageStat {
  stage: string;
  phase: BuildPhase;
  is_gate: boolean;
  samples: number;
  failures: number;
  median_ms: number;
  p90_ms: number;
  max_ms: number;
  // Median start, measured from the start of the run.
  median_offset_ms: number;
  share: number;
  // Median cores kept busy and the largest memory seen, when runs report
  // resources.
  cores_median: number | null;
  memory_max_bytes: number | null;
}

// Durations of top-level stages across runs. Completed stages of failed runs
// still count: they measure that stage, not the run's outcome.
export function stageStatistics(history: BuildTimeline[]): StageStat[] {
  const byStage = new Map<
    string,
    {
      durations: number[];
      offsets: number[];
      failures: number;
      phase: BuildPhase;
      gate: boolean;
      cores: number[];
      memory: number[];
    }
  >();
  for (const run of history) {
    const seen = new Map<
      string,
      { duration: number; offset: number; failed: boolean; cores: number | null; memory: number | null }
    >();
    for (const span of topLevelSpans(run)) {
      if (span.end_ms == null || run.started_ms == null) continue;
      // Re-entered stages (v1 transitions back into a stage) sum per run.
      const previous = seen.get(span.stage);
      const cores = stageCores(span);
      const memory = stageMemoryBytes(span);
      seen.set(span.stage, {
        duration: (previous?.duration ?? 0) + (span.end_ms - span.start_ms),
        offset: previous?.offset ?? span.start_ms - run.started_ms,
        failed: (previous?.failed ?? false) || span.status === "failed",
        cores: cores ?? previous?.cores ?? null,
        memory: Math.max(memory ?? 0, previous?.memory ?? 0) || null,
      });
      if (!byStage.has(span.stage)) {
        byStage.set(span.stage, {
          durations: [],
          offsets: [],
          failures: 0,
          phase: span.phase,
          gate: span.is_gate,
          cores: [],
          memory: [],
        });
      }
    }
    for (const [stage, sample] of seen) {
      const entry = byStage.get(stage)!;
      entry.durations.push(sample.duration);
      entry.offsets.push(sample.offset);
      if (sample.failed) entry.failures += 1;
      if (sample.cores != null) entry.cores.push(sample.cores);
      if (sample.memory != null) entry.memory.push(sample.memory);
    }
  }
  const stats: StageStat[] = [...byStage].map(([stage, entry]) => ({
    stage,
    phase: entry.phase,
    is_gate: entry.gate,
    samples: entry.durations.length,
    failures: entry.failures,
    median_ms: quantile(entry.durations, 0.5),
    p90_ms: quantile(entry.durations, 0.9),
    max_ms: Math.max(...entry.durations),
    median_offset_ms: quantile(entry.offsets, 0.5),
    share: 0,
    cores_median: entry.cores.length ? quantile(entry.cores, 0.5) : null,
    memory_max_bytes: entry.memory.length ? Math.max(...entry.memory) : null,
  }));
  const total = stats.reduce((sum, stat) => sum + stat.median_ms, 0);
  for (const stat of stats) stat.share = total > 0 ? stat.median_ms / total : 0;
  return stats.sort((a, b) => a.median_offset_ms - b.median_offset_ms);
}

export function comparableHistory(
  run: BuildTimeline,
  runs: BuildTimeline[],
): BuildTimeline[] {
  return runs
    .filter(
      (other) =>
        other.run_id !== run.run_id &&
        other.pipeline === run.pipeline &&
        other.state !== "running" &&
        other.started_ms != null &&
        topLevelSpans(other).some((span) => span.end_ms != null),
    )
    .sort((a, b) => (b.started_ms ?? 0) - (a.started_ms ?? 0))
    .slice(0, HISTORY_LIMIT);
}

export interface CalibrationRate {
  pass: number;
  epoch: number;
  epochs: number;
  seconds_per_epoch: number;
  remaining_ms: number;
}

// Rate over the most recent stretch of the current solver pass.
export function calibrationRate(points: CalibrationPoint[]): CalibrationRate | null {
  if (!points.length) return null;
  const last = points[points.length - 1];
  if (last.epoch == null || last.epochs == null) return null;
  const pass = points.filter((point) => point.pass === last.pass && point.epoch != null);
  const window = pass.slice(-30);
  if (window.length < 2) return null;
  const first = window[0];
  const epochs = (last.epoch as number) - (first.epoch as number);
  const elapsed = last.time_ms - first.time_ms;
  if (epochs <= 0 || elapsed <= 0) return null;
  const secondsPerEpoch = elapsed / 1000 / epochs;
  return {
    pass: last.pass,
    epoch: last.epoch,
    epochs: last.epochs,
    seconds_per_epoch: secondsPerEpoch,
    remaining_ms: Math.max(0, last.epochs - last.epoch) * secondsPerEpoch * 1000,
  };
}

interface StageBlock {
  start_ms: number;
  end_ms: number | null;
}

// A stage's block in one run: from its first start to its last end. Version 1
// runs can re-enter a stage (export, release gates), and the block covers the
// whole stretch.
function stageBlock(run: BuildTimeline, stage: string): StageBlock | null {
  const spans = topLevelSpans(run).filter((span) => span.stage === stage);
  if (!spans.length) return null;
  const last = spans[spans.length - 1];
  return { start_ms: spans[0].start_ms, end_ms: last.end_ms };
}

export interface StageWorkRate {
  done: number;
  total: number;
  remaining_ms: number;
}

// Remaining time of a stage from the work units it reports, at the rate of
// its recent samples.
export function stageWorkRate(
  span: StageSpan | null,
  nowMs: number = Date.now(),
): StageWorkRate | null {
  const work = span?.work;
  if (work && work.done > 0 && work.total > 0) {
    // Reported work carries its own elapsed time, so one snapshot is a rate;
    // time since that snapshot counts against what was left then.
    const perUnitMs = (work.elapsed_seconds * 1000) / work.done;
    const remainingThen = perUnitMs * Math.max(0, work.total - work.done);
    return {
      done: work.done,
      total: work.total,
      remaining_ms: Math.max(0, remainingThen - Math.max(0, nowMs - work.updated_ms)),
    };
  }
  if (!span || span.progress.length < 2) return null;
  const last = span.progress[span.progress.length - 1];
  const window = span.progress.filter((point) => point.total === last.total).slice(-30);
  if (window.length < 2) return null;
  const first = window[0];
  const units = last.done - first.done;
  const elapsed = last.time_ms - first.time_ms;
  if (units <= 0 || elapsed <= 0) return null;
  return {
    done: last.done,
    total: last.total,
    remaining_ms: (Math.max(0, last.total - last.done) * elapsed) / units,
  };
}

// How fast this run is going relative to comparable runs: its finished
// stages' durations over those stages' typical durations, plus the current
// stage once it has run longer than typical. Only stages long enough to
// measure count, and the factor is clamped so one odd stage cannot swing it.
export function paceFactor(
  run: BuildTimeline,
  stats: Map<string, StageStat>,
  nowMs: number = Date.now(),
): number | null {
  let observed = 0;
  let typical = 0;
  for (const span of topLevelSpans(run)) {
    const stat = stats.get(span.stage);
    if (!stat || stat.median_ms < 20_000) continue;
    const duration = (span.end_ms ?? nowMs) - span.start_ms;
    if (span.end_ms == null && duration <= stat.median_ms) continue;
    observed += duration;
    typical += stat.median_ms;
  }
  if (typical < 60_000) return null;
  return Math.min(3, Math.max(0.5, observed / typical));
}

export interface StageForecast {
  stage: string;
  phase: BuildPhase;
  // Expected start and end, measured from the start of the run.
  start_offset_ms: number;
  end_offset_ms: number;
  status: "done" | "running" | "pending";
  basis: "observed" | "history" | "measured_rate" | "unknown";
}

export interface BuildForecast {
  basis_runs: string[];
  method: "milestone" | "run_total" | "rate_only" | "none" | "finished";
  pace: number | null;
  elapsed_ms: number;
  remaining_p50_ms: number | null;
  remaining_p90_ms: number | null;
  finish_p50_ms: number | null;
  finish_p90_ms: number | null;
  fraction_complete: number | null;
  current_stage: string | null;
  current_stage_elapsed_ms: number | null;
  current_stage_typical_ms: number | null;
  current_stage_p90_ms: number | null;
  overrunning: boolean;
  calibration: CalibrationRate | null;
  stage_work: StageWorkRate | null;
  stages: StageForecast[];
  note: string | null;
}

interface Range {
  p50: number;
  p90: number;
}

function range(samples: number[]): Range | null {
  if (!samples.length) return null;
  return { p50: quantile(samples, 0.5), p90: quantile(samples, 0.9) };
}

// Remaining time for a running build, from finished runs of the same pipeline.
// It splits at the stage this run is in (or last finished):
// - the rest of that stage: the past durations of the stage that ran longer
//   than this run has so far, minus the time already spent; while the solver
//   runs, the remaining epochs at the observed epoch rate set a floor;
// - everything after it: in each past run, the time from the end of that stage
//   to the end of the run (gaps between stages included), scaled by this run's
//   pace.
// When no past run reached this stage, it falls back to the typical total run
// time. The p90 adds the two parts' spreads in quadrature.
export function forecastCompletion(
  run: BuildTimeline,
  runs: BuildTimeline[],
  nowMs: number = Date.now(),
): BuildForecast | null {
  if (run.started_ms == null) return null;
  const runStart = run.started_ms;
  const elapsed = (run.ended_ms ?? nowMs) - runStart;
  const history = comparableHistory(run, runs);
  // Runs that reached the end, whether or not their gates passed.
  const finished = history.filter(
    (other) => (other.state === "passed" || other.state === "blocked") && other.ended_ms != null,
  );
  const stats = new Map(stageStatistics(history).map((stat) => [stat.stage, stat]));
  const observed = topLevelSpans(run);
  const done: StageForecast[] = observed
    .filter((span) => span.end_ms != null)
    .map((span) => ({
      stage: span.stage,
      phase: span.phase,
      start_offset_ms: span.start_ms - runStart,
      end_offset_ms: span.end_ms! - runStart,
      status: "done",
      basis: "observed",
    }));
  const base = {
    basis_runs: history.map((other) => other.run_id),
    elapsed_ms: elapsed,
  };

  if (run.state !== "running") {
    return {
      ...base,
      method: "finished",
      pace: paceFactor(run, stats, nowMs),
      remaining_p50_ms: 0,
      remaining_p90_ms: 0,
      finish_p50_ms: run.ended_ms,
      finish_p90_ms: run.ended_ms,
      fraction_complete: run.state === "passed" ? 1 : null,
      current_stage: null,
      current_stage_elapsed_ms: null,
      current_stage_typical_ms: null,
      current_stage_p90_ms: null,
      overrunning: false,
      calibration: null,
      stage_work: null,
      stages: done,
      note: null,
    };
  }

  const pace = paceFactor(run, stats, nowMs);
  const scale = pace ?? 1;
  const rate = calibrationRate(run.calibration);
  const current = observed.find((span) => span.end_ms == null) ?? null;
  const anchor = current ?? (observed.length ? observed[observed.length - 1] : null);
  const anchorBlock = anchor ? stageBlock(run, anchor.stage) : null;
  const currentElapsed = current && anchorBlock ? nowMs - anchorBlock.start_ms : null;
  const currentStat = current ? stats.get(current.stage) : undefined;
  const calibrating =
    current != null &&
    rate != null &&
    (current.phase === "calibrate" || /calibrat/.test(current.stage));
  const work = stageWorkRate(current, nowMs);
  const rateFloor = Math.max(calibrating ? rate!.remaining_ms : 0, work?.remaining_ms ?? 0);

  // Past runs that reached the anchor stage.
  const durations: number[] = [];
  const after: number[] = [];
  if (anchor) {
    for (const other of finished) {
      const block = stageBlock(other, anchor.stage);
      if (!block || block.end_ms == null) continue;
      durations.push(block.end_ms - block.start_ms);
      after.push(other.ended_ms! - block.end_ms);
    }
  }

  let method: BuildForecast["method"] = "none";
  let currentRange: Range = { p50: 0, p90: 0 };
  let afterRange: Range | null = null;
  let overrunning = false;
  if (anchor && after.length) {
    method = "milestone";
    if (current) {
      const longer = durations.filter((duration) => duration > currentElapsed!);
      const conditional = range(longer.map((duration) => duration - currentElapsed!));
      overrunning = !longer.length;
      // Past every comparable run: no data on how much longer it takes.
      currentRange = conditional ?? { p50: 0.1 * currentElapsed!, p90: 0.5 * currentElapsed! };
    } else {
      // Between stages: count the gap already spent since the last one ended.
      const since = nowMs - (anchorBlock?.end_ms ?? nowMs);
      currentRange = { p50: -since, p90: -since };
    }
    const scaled = range(after.map((value) => value * scale))!;
    afterRange = scaled;
  } else if (finished.length) {
    method = "run_total";
    const totals = range(finished.map((other) => (other.ended_ms! - other.started_ms!) * scale))!;
    afterRange = { p50: Math.max(0, totals.p50 - elapsed), p90: Math.max(0, totals.p90 - elapsed) };
    overrunning = totals.p90 < elapsed;
  } else if (calibrating || work) {
    method = "rate_only";
  }
  // A stage that reports its own batches is timed by them: its measured
  // rate is specific to this run, where history only says what other runs
  // took. Wait for a few units so the rate means something. The solver's
  // epoch rate stays a floor, because size search and refits repeat passes.
  const measured = current?.work != null && work != null && work.done >= Math.min(3, work.total);
  if (measured) {
    currentRange = { p50: work!.remaining_ms, p90: work!.remaining_ms * 1.25 };
    overrunning = false;
  } else if (calibrating || work) {
    currentRange = {
      p50: Math.max(currentRange.p50, rateFloor),
      p90: Math.max(currentRange.p90, rateFloor),
    };
  }

  let p50: number | null = null;
  let p90: number | null = null;
  if (method !== "none") {
    const afterP50 = afterRange?.p50 ?? 0;
    const afterP90 = afterRange?.p90 ?? 0;
    p50 = Math.max(0, currentRange.p50 + afterP50);
    // A handful of past runs understates the spread; keep the p90 at least
    // 30% (and 30 seconds) above the p50.
    p90 = Math.max(
      p50 * 1.3 + 30_000,
      p50 + Math.sqrt((currentRange.p90 - currentRange.p50) ** 2 + (afterP90 - afterP50) ** 2),
    );
  }

  // Lay out the stages still ahead (the order the most recent finished run
  // took after the anchor stage) so they end at the forecast.
  const stages: StageForecast[] = [...done];
  const currentRemaining = Math.max(0, method === "milestone" ? currentRange.p50 : rateFloor);
  let cursor = elapsed;
  if (current) {
    stages.push({
      stage: current.stage,
      phase: current.phase,
      start_offset_ms: current.start_ms - runStart,
      end_offset_ms: cursor + currentRemaining,
      status: "running",
      basis:
        (calibrating || work) && rateFloor >= currentRemaining
          ? "measured_rate"
          : method === "milestone"
            ? "history"
            : "unknown",
    });
    cursor += currentRemaining;
  }
  const reference = finished[0] ?? history[0];
  const seen = new Set(observed.map((span) => span.stage));
  const ahead: StageStat[] = [];
  if (reference) {
    const order = topLevelSpans(reference).map((span) => span.stage);
    const from = anchor ? order.lastIndexOf(anchor.stage) : -1;
    for (const stage of order.slice(from + 1)) {
      const stat = stats.get(stage);
      if (stat && !seen.has(stage) && !ahead.includes(stat)) ahead.push(stat);
    }
  }
  const aheadTypical = ahead.reduce((sum, stat) => sum + stat.median_ms, 0);
  const aheadBudget = p50 != null ? Math.max(0, p50 - currentRemaining) : aheadTypical * scale;
  const stretch = aheadTypical > 0 ? aheadBudget / aheadTypical : 1;
  for (const stat of ahead) {
    const duration = stat.median_ms * stretch;
    stages.push({
      stage: stat.stage,
      phase: stat.phase,
      start_offset_ms: cursor,
      end_offset_ms: cursor + duration,
      status: "pending",
      basis: "history",
    });
    cursor += duration;
  }

  let note: string | null = null;
  if (!finished.length) {
    note =
      calibrating || work
        ? "No finished comparable runs yet; the estimate covers the current stage only."
        : "No finished comparable runs yet, so there is nothing to forecast from.";
  } else if (method === "run_total") {
    note = "No finished run reached this stage; the estimate uses typical total run time.";
  } else if (overrunning) {
    note = "This stage has already run longer than in any comparable run, so the estimate is uncertain.";
  } else if (calibrating) {
    note = "Solver passes can repeat (size search, refits); later passes count only through past runs.";
  }
  return {
    ...base,
    method,
    pace,
    remaining_p50_ms: p50,
    remaining_p90_ms: p90,
    finish_p50_ms: p50 != null ? nowMs + p50 : null,
    finish_p90_ms: p90 != null ? nowMs + p90 : null,
    fraction_complete: p50 != null && elapsed + p50 > 0 ? elapsed / (elapsed + p50) : null,
    current_stage: current?.stage ?? null,
    current_stage_elapsed_ms: currentElapsed,
    current_stage_typical_ms: currentStat ? currentStat.median_ms : null,
    current_stage_p90_ms: currentStat ? currentStat.p90_ms : null,
    overrunning,
    calibration: calibrating ? rate : null,
    stage_work: work,
    stages,
    note,
  };
}

export interface GateStat {
  gate: string;
  failures: number;
  runs: number;
  // Compute already spent when the gate failed (median across failures).
  median_offset_ms: number | null;
  last_failed_run: string | null;
  last_message: string | null;
  reasons: { reason: string; count: number }[];
}

// Group batched gate failure lines ("Export input mass failed: ...") by the
// check that produced them.
export function failureReason(line: string): string {
  const head = line.split(/:\s/)[0].trim();
  return head.length > 90 ? `${head.slice(0, 87)}…` : head;
}

export function gateStatistics(runs: BuildTimeline[]): GateStat[] {
  interface GateEntry {
    offsets: number[];
    failures: number;
    last: BuildTimeline | null;
    message: string | null;
    reasons: Map<string, number>;
  }
  const byGate = new Map<string, GateEntry>();
  const sorted = [...runs].sort((a, b) => (a.started_ms ?? 0) - (b.started_ms ?? 0));
  for (const run of sorted) {
    for (const span of run.spans) {
      if (!span.is_gate || span.status !== "failed") continue;
      const entry: GateEntry = byGate.get(span.stage) ?? {
        offsets: [],
        failures: 0,
        last: null,
        message: null,
        reasons: new Map(),
      };
      entry.failures += 1;
      if (run.started_ms != null) entry.offsets.push(span.start_ms - run.started_ms);
      entry.last = run;
      entry.message = span.message;
      for (const line of span.failures) {
        const reason = failureReason(line);
        entry.reasons.set(reason, (entry.reasons.get(reason) ?? 0) + 1);
      }
      byGate.set(span.stage, entry);
    }
  }
  return [...byGate]
    .map(([gate, entry]) => ({
      gate,
      failures: entry.failures,
      runs: runs.length,
      median_offset_ms: entry.offsets.length ? quantile(entry.offsets, 0.5) : null,
      last_failed_run: entry.last?.run_id ?? null,
      last_message: entry.message,
      reasons: [...entry.reasons]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (b.median_offset_ms ?? 0) * b.failures - (a.median_offset_ms ?? 0) * a.failures);
}

export interface FailureClassStat {
  failure_class: string;
  runs: number;
  // Median wall time already spent when runs of this kind stopped.
  median_compute_lost_ms: number | null;
  last_run_id: string | null;
}

// Why runs stopped, by kind. Blocked runs count as gate refusals; a run that
// went silent counts as stopped without a final event (a kill).
export function failureClassStatistics(runs: BuildTimeline[]): FailureClassStat[] {
  const byClass = new Map<string, { lost: number[]; runs: number; last: BuildTimeline | null }>();
  const sorted = [...runs].sort((a, b) => (a.started_ms ?? 0) - (b.started_ms ?? 0));
  for (const run of sorted) {
    let failureClass: string | null = null;
    if (run.state === "failed") failureClass = run.failure?.failure_class ?? "unclassified";
    else if (run.state === "blocked") failureClass = "gate_refused";
    else if (run.state === "stalled") failureClass = "stopped_without_final_event";
    if (!failureClass) continue;
    const entry = byClass.get(failureClass) ?? { lost: [], runs: 0, last: null };
    entry.runs += 1;
    const end = run.ended_ms ?? run.updated_ms;
    if (run.started_ms != null && end != null) entry.lost.push(end - run.started_ms);
    entry.last = run;
    byClass.set(failureClass, entry);
  }
  return [...byClass]
    .map(([failureClass, entry]) => ({
      failure_class: failureClass,
      runs: entry.runs,
      median_compute_lost_ms: entry.lost.length ? quantile(entry.lost, 0.5) : null,
      last_run_id: entry.last?.run_id ?? null,
    }))
    .sort((a, b) => b.runs - a.runs);
}

export interface PhaseTotals {
  run_id: string;
  state: BuildRunState;
  started_ms: number | null;
  total_ms: number | null;
  phases: Record<BuildPhase, number>;
}

export function phaseTotals(run: BuildTimeline, nowMs: number = Date.now()): PhaseTotals {
  const phases: Record<BuildPhase, number> = {
    setup: 0,
    checks: 0,
    compile: 0,
    calibrate: 0,
    export: 0,
  };
  for (const span of topLevelSpans(run)) {
    phases[span.phase] += spanDurationMs(span, nowMs);
  }
  return {
    run_id: run.run_id,
    state: run.state,
    started_ms: run.started_ms,
    total_ms: runDurationMs(run, nowMs),
    phases,
  };
}

// The list view ships timelines without per-epoch calibration points.
export function compactTimeline(timeline: BuildTimeline): BuildTimeline {
  return { ...timeline, calibration: [] };
}
