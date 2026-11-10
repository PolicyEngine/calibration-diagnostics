type JsonObject = Record<string, unknown>;

// The build machine as microcosm-emitter 0.14.0 and later records it: a
// reading on each heartbeat, the machine's sleeps, and each producer's
// description of its machine with a Modal stage's resource request.

// One heartbeat's reading of the build's processes and the machine.
export interface MachineReading {
  time_ms: number;
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

export function machineReadings(_events: readonly JsonObject[]): MachineReading[] {
  return [];
}

export function downsampleReadings(
  readings: MachineReading[],
  _limit: number = READING_LIMIT,
): MachineReading[] {
  return readings;
}

export function sleepBands(_events: readonly JsonObject[]): SleepBand[] {
  return [];
}

export function machineSegments(_events: readonly JsonObject[]): MachineSegment[] {
  return [];
}

export function readingRuns(
  readings: readonly MachineReading[],
  _sleeps: readonly SleepBand[],
): MachineReading[][] {
  return [readings.slice()];
}

export function memoryLimitBytes(_machine: MachineSegment): number | null {
  return null;
}

export function availableCores(_machine: MachineSegment): number | null {
  return null;
}
