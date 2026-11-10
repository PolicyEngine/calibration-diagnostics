type JsonObject = Record<string, unknown>;

// The build machine as microcosm-emitter 0.14.0 and later records it: a
// reading on each heartbeat, the machine's sleeps, and each producer's
// description of its machine with a Modal stage's resource request.

// One heartbeat's reading of the build's processes and the machine.
export interface MachineReading {
  time_ms: number;
  // The earliest reading this one stands for: its own time, or, for a reading
  // that stands for several (`downsampleReadings`), the first one's.
  first_reading_ms: number;
  producer_id: string | null;
  // The open stages, outermost first.
  stages: string[];
  memory_bytes: number | null;
  // The largest memory a 1 s sample saw since the previous reading.
  memory_peak_bytes: number | null;
  // User and system CPU, in cores, over the reading's interval.
  cpu_cores: number | null;
  // The share of the whole machine's CPU in use over the interval.
  machine_cpu_share: number | null;
  memory_available_bytes: number | null;
}

// A stretch the machine slept: recorded by the emitter, or, for a producer
// from before readings, estimated from a gap between its heartbeats.
export interface SleepBand {
  start_ms: number;
  end_ms: number;
  estimated: boolean;
  producer_id: string | null;
}

// A Modal stage's resource request, as the US Modal stage runner set it.
export interface ModalRequest {
  resource_class: string;
  cpu: number;
  cpu_limit: number | null;
  memory_bytes: number;
}

// The machine one producer ran on, from its first event to its last.
export interface MachineSegment {
  producer_id: string | null;
  start_ms: number;
  end_ms: number;
  kind: "local" | "modal_container" | null;
  os: string | null;
  os_version: string | null;
  cpu_model: string | null;
  logical_cpus: number | null;
  memory_total_bytes: number | null;
  cgroup_cpu_limit_cores: number | null;
  cgroup_memory_limit_bytes: number | null;
  modal_task_id: string | null;
  modal_region: string | null;
  request: ModalRequest | null;
}

// The most readings a run response carries.
export const READING_LIMIT = 600;
// A gap at least this long between a producer's heartbeats is a sleep (for a
// producer from before readings) or a break in the charts.
export const READING_GAP_MS = 5 * 60_000;

const MEBIBYTE = 1024 * 1024;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function timeMs(value: unknown): number | null {
  const text = str(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function eventTime(event: JsonObject): number | null {
  return timeMs(event.time) ?? timeMs(event.timestamp);
}

function eventStage(event: JsonObject): string | null {
  return str(event.stage) ?? str(event.stage_id);
}

function producer(event: JsonObject): string | null {
  return str(event.producer_id);
}

// Events with a time, in time order.
function timed(events: readonly JsonObject[]): { event: JsonObject; time: number }[] {
  return events
    .map((event) => ({ event, time: eventTime(event) }))
    .filter((item): item is { event: JsonObject; time: number } => item.time != null)
    .sort((first, second) => first.time - second.time);
}

// Each producer's events, in time order, in the order the producers started.
function byProducer(events: readonly JsonObject[]): Map<string | null, { event: JsonObject; time: number }[]> {
  const groups = new Map<string | null, { event: JsonObject; time: number }[]>();
  for (const item of timed(events)) {
    const key = producer(item.event);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function sum(first: number | null, second: number | null): number | null {
  return first == null && second == null ? null : (first ?? 0) + (second ?? 0);
}

function stageList(value: unknown, fallback: string | null): string[] {
  const stages = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  return stages.length || !fallback ? stages : [fallback];
}

export function machineReadings(events: readonly JsonObject[]): MachineReading[] {
  const readings: MachineReading[] = [];
  for (const { event, time } of timed(events)) {
    const reading = obj(obj(event.details)?.reading);
    if (!reading) continue;
    const tree = obj(reading.process_tree);
    const machine = obj(reading.machine);
    readings.push({
      time_ms: time,
      first_reading_ms: time,
      producer_id: producer(event),
      stages: stageList(reading.stages, eventStage(event)),
      memory_bytes: num(tree?.memory_bytes),
      memory_peak_bytes: num(tree?.interval_memory_peak_bytes) ?? num(tree?.memory_bytes),
      cpu_cores: sum(num(tree?.cpu_user_cores), num(tree?.cpu_system_cores)),
      machine_cpu_share: num(machine?.cpu_busy_share),
      memory_available_bytes: num(machine?.memory_available_bytes),
    });
  }
  return readings;
}

function largest(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length ? Math.max(...known) : null;
}

function smallest(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length ? Math.min(...known) : null;
}

// One reading standing for a bucket of consecutive readings: the last one's
// time and stages, the first one's start, and the bucket's peaks (and its
// least free memory).
function merged(bucket: MachineReading[]): MachineReading {
  const last = bucket[bucket.length - 1];
  return {
    ...last,
    first_reading_ms: bucket[0].first_reading_ms,
    memory_bytes: largest(bucket.map((item) => item.memory_bytes)),
    memory_peak_bytes: largest(bucket.map((item) => item.memory_peak_bytes ?? item.memory_bytes)),
    cpu_cores: largest(bucket.map((item) => item.cpu_cores)),
    machine_cpu_share: largest(bucket.map((item) => item.machine_cpu_share)),
    memory_available_bytes: smallest(bucket.map((item) => item.memory_available_bytes)),
  };
}

// At most about `limit` readings, each standing for a stretch of consecutive
// readings of one producer and one set of open stages, with no gap of
// `READING_GAP_MS` or more inside it, and keeping its peaks. A run with more
// such stretches than `limit` keeps one reading for each.
export function downsampleReadings(readings: MachineReading[], limit: number = READING_LIMIT): MachineReading[] {
  if (readings.length <= limit) return readings;
  const size = Math.ceil(readings.length / Math.max(1, Math.floor(limit / 2)));
  const kept: MachineReading[] = [];
  let bucket: MachineReading[] = [];
  for (const reading of readings) {
    const previous = bucket[bucket.length - 1];
    if (
      previous &&
      (bucket.length >= size ||
        previous.producer_id !== reading.producer_id ||
        previous.stages.join("\u0000") !== reading.stages.join("\u0000") ||
        reading.first_reading_ms - previous.time_ms >= READING_GAP_MS)
    ) {
      kept.push(merged(bucket));
      bucket = [];
    }
    bucket.push(reading);
  }
  if (bucket.length) kept.push(merged(bucket));
  return kept;
}

// A heartbeat from before readings: a progress event with no message and no
// details, which only the emitter sends.
function oldHeartbeat(event: JsonObject): boolean {
  const details = obj(event.details);
  return (
    str(event.status) === "progress" &&
    str(event.message) == null &&
    details != null &&
    Object.keys(details).length === 0 &&
    obj(event.resources) != null
  );
}

// The sleeps each producer recorded. A producer from before readings that sent
// heartbeats has a sleep estimated wherever its events stop for
// `READING_GAP_MS` or more between two of its heartbeats.
export function sleepBands(events: readonly JsonObject[]): SleepBand[] {
  const bands: SleepBand[] = [];
  for (const [producerId, items] of byProducer(events)) {
    const recordsReadings = items.some(({ event }) => {
      const details = obj(event.details);
      return obj(details?.reading) != null || obj(details?.sleep) != null;
    });
    if (recordsReadings) {
      for (const { event } of items) {
        const sleep = obj(obj(event.details)?.sleep);
        const start = timeMs(sleep?.started_at);
        const end = timeMs(sleep?.ended_at);
        if (start != null && end != null && end > start) {
          bands.push({ start_ms: start, end_ms: end, estimated: false, producer_id: producerId });
        }
      }
      continue;
    }
    const beats = items.filter(({ event }) => oldHeartbeat(event)).map(({ time }) => time);
    if (beats.length < 2) continue;
    const first = beats[0];
    const last = beats[beats.length - 1];
    for (let index = 1; index < items.length; index += 1) {
      const before = items[index - 1].time;
      const after = items[index].time;
      if (before >= first && after <= last && after - before >= READING_GAP_MS) {
        bands.push({ start_ms: before, end_ms: after, estimated: true, producer_id: producerId });
      }
    }
  }
  return bands.sort((first, second) => first.start_ms - second.start_ms);
}

function modalRequest(value: unknown): ModalRequest | null {
  const request = obj(value);
  const resourceClass = str(request?.class);
  const cpu = num(request?.cpu);
  const memory = num(request?.memory_mib);
  const limit = request?.cpu_limit;
  if (!request || !resourceClass || cpu == null || cpu <= 0 || memory == null || memory <= 0) return null;
  if (limit != null && (num(limit) == null || (limit as number) <= 0)) return null;
  return {
    resource_class: resourceClass,
    cpu,
    cpu_limit: num(limit),
    memory_bytes: memory * MEBIBYTE,
  };
}

function machineKind(value: unknown): MachineSegment["kind"] {
  return value === "local" || value === "modal_container" ? value : null;
}

// The machine each producer ran on, from its run start's description, for
// the time from its first event to its last.
export function machineSegments(events: readonly JsonObject[]): MachineSegment[] {
  const segments: MachineSegment[] = [];
  for (const [producerId, items] of byProducer(events)) {
    const start = items.find(({ event }) => obj(obj(event.details)?.environment) != null);
    if (!start) continue;
    const details = obj(start.event.details);
    const environment = obj(details?.environment)!;
    const modal = obj(environment.modal);
    segments.push({
      producer_id: producerId,
      start_ms: items[0].time,
      end_ms: items[items.length - 1].time,
      kind: machineKind(environment.kind),
      os: str(environment.os),
      os_version: str(environment.os_version),
      cpu_model: str(environment.cpu_model),
      logical_cpus: num(environment.logical_cpus),
      memory_total_bytes: num(environment.memory_total_bytes),
      cgroup_cpu_limit_cores: num(environment.cgroup_cpu_limit_cores),
      cgroup_memory_limit_bytes: num(environment.cgroup_memory_limit_bytes),
      modal_task_id: str(modal?.task_id),
      modal_region: str(modal?.region),
      request: modalRequest(obj(details?.identity)?.modal_resources),
    });
  }
  return segments.sort((first, second) => first.start_ms - second.start_ms);
}

// The stretches a chart draws as one line: consecutive readings of one
// producer, broken at a gap of `READING_GAP_MS` or more (from a reading to the
// first reading the next one stands for) and before a reading whose stretch
// holds or follows a sleep.
export function readingRuns(readings: readonly MachineReading[], sleeps: readonly SleepBand[]): MachineReading[][] {
  const runs: MachineReading[][] = [];
  let current: MachineReading[] = [];
  for (const reading of readings) {
    const previous = current[current.length - 1];
    const breaks =
      previous != null &&
      (previous.producer_id !== reading.producer_id ||
        reading.first_reading_ms - previous.time_ms >= READING_GAP_MS ||
        sleeps.some((sleep) => sleep.start_ms < reading.time_ms && sleep.end_ms > previous.time_ms));
    if (breaks) {
      runs.push(current);
      current = [];
    }
    current.push(reading);
  }
  if (current.length) runs.push(current);
  return runs;
}

// The memory a producer's build could use: its Modal request, else its
// cgroup's limit, else the machine's total.
export function memoryLimitBytes(machine: MachineSegment): number | null {
  return machine.request?.memory_bytes ?? machine.cgroup_memory_limit_bytes ?? machine.memory_total_bytes;
}

// The cores a producer's build was given: its Modal request, else its
// cgroup's limit, else the machine's logical CPUs.
export function availableCores(machine: MachineSegment): number | null {
  return machine.request?.cpu ?? machine.cgroup_cpu_limit_cores ?? machine.logical_cpus;
}
