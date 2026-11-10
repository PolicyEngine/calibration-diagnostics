import { describe, expect, test } from "bun:test";

import {
  availableCores,
  downsampleReadings,
  type MachineReading,
  type MachineSegment,
  machineReadings,
  machineSegments,
  memoryLimitBytes,
  READING_LIMIT,
  readingRuns,
  sleepBands,
} from "./machine-readings";

const T0 = Date.parse("2026-11-09T10:00:00Z");
const MINUTE = 60_000;
const GIB = 1024 ** 3;
const at = (minute: number) => T0 + minute * MINUTE;
const iso = (minute: number) => new Date(at(minute)).toISOString();

type Event = Record<string, unknown>;

// A heartbeat as read API v1 serves it: a `stage` event with status
// `progress`, the emitter's reading in its details.
function heartbeat(
  minute: number,
  producer: string,
  values: { memory?: number | null; cores?: number | null; busy?: number | null; stages?: string[] } = {},
  details: Event = {},
): Event {
  const cores = values.cores === undefined ? 2 : values.cores;
  return {
    event_type: "stage",
    stage_id: values.stages?.at(-1) ?? "calibrate",
    status: "progress",
    time: iso(minute),
    timestamp: iso(minute),
    producer_id: producer,
    message: null,
    resources: { rss_bytes: 1 },
    details: {
      reading: {
        interval_seconds: 30,
        late_seconds: 0,
        stages: values.stages ?? ["calibrate"],
        progress: null,
        process_tree: {
          processes: 3,
          memory_bytes: values.memory === undefined ? 4 * GIB : values.memory,
          memory_peak_bytes: 6 * GIB,
          interval_memory_peak_bytes: values.memory === undefined ? 5 * GIB : values.memory,
          cpu_user_cores: cores == null ? null : cores * 0.75,
          cpu_system_cores: cores == null ? null : cores * 0.25,
          disk_read_bytes: 0,
          disk_written_bytes: 0,
        },
        machine: {
          memory_available_bytes: 20 * GIB,
          cpu_busy_share: values.busy === undefined ? 0.4 : values.busy,
        },
      },
      ...details,
    },
  };
}

// A heartbeat from an emitter before 0.14.0: no message and no details.
function oldHeartbeat(minute: number, producer: string): Event {
  return {
    event_type: "stage",
    stage_id: "calibrate",
    status: "progress",
    time: iso(minute),
    producer_id: producer,
    message: null,
    resources: { rss_bytes: 1, cpu_user_seconds: minute },
    details: {},
  };
}

function stageEvent(minute: number, producer: string, stage: string, status: string, details: Event = {}): Event {
  return {
    event_type: "stage",
    stage_id: stage,
    status,
    time: iso(minute),
    producer_id: producer,
    message: null,
    resources: null,
    details,
  };
}

function runStart(minute: number, producer: string, environment: Event, identity: Event = {}): Event {
  return stageEvent(minute, producer, "created", "started", { identity, environment });
}

const LOCAL_ENVIRONMENT = {
  kind: "local",
  os: "Darwin",
  os_version: "26.3",
  architecture: "arm64",
  cpu_model: "Apple M1 Max",
  logical_cpus: 10,
  memory_total_bytes: 32 * GIB,
  cgroup_cpu_limit_cores: null,
  cgroup_memory_limit_bytes: null,
  modal: null,
  emitter_version: "0.14.0",
  python_version: "3.13.13",
};

const MODAL_ENVIRONMENT = {
  ...LOCAL_ENVIRONMENT,
  kind: "modal_container",
  os: "Linux",
  os_version: "4.4.0",
  cpu_model: "AMD EPYC",
  logical_cpus: 64,
  memory_total_bytes: 512 * GIB,
  cgroup_cpu_limit_cores: 20,
  cgroup_memory_limit_bytes: null,
  modal: { task_id: "ta-01", region: "us-east", cloud_provider: "CLOUD_PROVIDER_AWS" },
};

const HEAVY = { class: "heavy", cpu: 4, cpu_limit: null, memory_mib: 128 * 1024 };

function reading(minute: number, producer: string, memory: number, cores = 1): MachineReading {
  return {
    time_ms: at(minute),
    producer_id: producer,
    stages: ["calibrate"],
    memory_bytes: memory,
    memory_peak_bytes: memory,
    cpu_cores: cores,
    machine_cpu_share: 0.5,
    memory_available_bytes: 10 * GIB,
  };
}

describe("machineReadings", () => {
  test("each heartbeat's reading gives its time, producer, stages, memory and CPU", () => {
    const events = [
      stageEvent(0, "p1", "calibrate", "started"),
      heartbeat(1, "p1", { memory: 3 * GIB, cores: 2, busy: 0.25, stages: ["calibrate", "solver"] }),
      stageEvent(1.5, "p1", "calibrate", "progress", { done: 1, total: 4 }),
      heartbeat(2, "p1", { memory: 5 * GIB, cores: null, busy: null }),
    ];

    expect(machineReadings(events)).toEqual([
      {
        time_ms: at(1),
        producer_id: "p1",
        stages: ["calibrate", "solver"],
        memory_bytes: 3 * GIB,
        memory_peak_bytes: 3 * GIB,
        cpu_cores: 2,
        machine_cpu_share: 0.25,
        memory_available_bytes: 20 * GIB,
      },
      {
        time_ms: at(2),
        producer_id: "p1",
        stages: ["calibrate"],
        memory_bytes: 5 * GIB,
        memory_peak_bytes: 5 * GIB,
        cpu_cores: null,
        machine_cpu_share: null,
        memory_available_bytes: 20 * GIB,
      },
    ]);
  });

  test("readings come in time order, whatever order the events arrived in", () => {
    const readings = machineReadings([heartbeat(3, "p1"), heartbeat(1, "p1"), heartbeat(2, "p1")]);

    expect(readings.map((item) => item.time_ms)).toEqual([at(1), at(2), at(3)]);
  });
});

describe("sleepBands", () => {
  test("a sleep the emitter recorded is a band from when it started to when it ended", () => {
    const sleep = { started_at: iso(10.5), ended_at: iso(40.25), seconds: 29.75 * 60 };
    const events = [heartbeat(10, "p1"), heartbeat(40.25, "p1", {}, { sleep })];

    expect(sleepBands(events)).toEqual([
      { start_ms: at(10.5), end_ms: at(40.25), estimated: false, producer_id: "p1" },
    ]);
  });

  test("an older producer's gap of 5 minutes or more between its heartbeats is an estimated sleep", () => {
    const events = [
      stageEvent(0, "old", "calibrate", "started"),
      ...[1, 2, 3, 4].map((minute) => oldHeartbeat(minute, "old")),
      // A 4-minute gap is late heartbeats, not a sleep.
      oldHeartbeat(8, "old"),
      // 8 to 38: 30 minutes without an event.
      oldHeartbeat(38, "old"),
      oldHeartbeat(39, "old"),
      stageEvent(40, "old", "calibrate", "completed"),
    ];

    expect(sleepBands(events)).toEqual([{ start_ms: at(8), end_ms: at(38), estimated: true, producer_id: "old" }]);
  });

  test("a producer that sends no heartbeats has no estimated sleeps, however long its stages", () => {
    const events = [
      stageEvent(0, "quiet", "load", "started"),
      stageEvent(90, "quiet", "load", "completed"),
      stageEvent(90, "quiet", "calibrate", "started"),
      stageEvent(400, "quiet", "calibrate", "completed"),
    ];

    expect(sleepBands(events)).toEqual([]);
  });

  test("a producer that sends readings has only the sleeps it recorded, never estimated ones", () => {
    const events = [heartbeat(0, "p1"), heartbeat(1, "p1"), heartbeat(30, "p1"), heartbeat(31, "p1")];

    expect(sleepBands(events)).toEqual([]);
  });

  test("a gap between two producers' events is a restart, not a sleep", () => {
    const events = [
      ...[0, 1, 2].map((minute) => oldHeartbeat(minute, "first")),
      ...[50, 51, 52].map((minute) => oldHeartbeat(minute, "second")),
    ];

    expect(sleepBands(events)).toEqual([]);
  });
});

describe("machineSegments", () => {
  test("each producer's machine runs from its first event to its last, with a Modal stage's request", () => {
    const events = [
      runStart(0, "local", LOCAL_ENVIRONMENT, { git_commit: "abc" }),
      heartbeat(5, "local"),
      stageEvent(20, "local", "load", "completed"),
      runStart(30, "modal", MODAL_ENVIRONMENT, { git_commit: "abc", modal_resources: HEAVY }),
      heartbeat(60, "modal"),
    ];

    expect(machineSegments(events)).toEqual([
      {
        producer_id: "local",
        start_ms: at(0),
        end_ms: at(20),
        kind: "local",
        os: "Darwin",
        os_version: "26.3",
        cpu_model: "Apple M1 Max",
        logical_cpus: 10,
        memory_total_bytes: 32 * GIB,
        cgroup_cpu_limit_cores: null,
        cgroup_memory_limit_bytes: null,
        modal_task_id: null,
        modal_region: null,
        request: null,
      },
      {
        producer_id: "modal",
        start_ms: at(30),
        end_ms: at(60),
        kind: "modal_container",
        os: "Linux",
        os_version: "4.4.0",
        cpu_model: "AMD EPYC",
        logical_cpus: 64,
        memory_total_bytes: 512 * GIB,
        cgroup_cpu_limit_cores: 20,
        cgroup_memory_limit_bytes: null,
        modal_task_id: "ta-01",
        modal_region: "us-east",
        request: { resource_class: "heavy", cpu: 4, cpu_limit: null, memory_bytes: 128 * GIB },
      },
    ]);
  });

  test("a producer whose run start describes no machine has none", () => {
    const events = [stageEvent(0, "p1", "created", "started", { identity: {} }), stageEvent(5, "p1", "load", "started")];

    expect(machineSegments(events)).toEqual([]);
  });

  test("a resource request that is not the runner's object is left out", () => {
    const events = [runStart(0, "modal", MODAL_ENVIRONMENT, { modal_resources: { class: "heavy", cpu: "four" } })];

    expect(machineSegments(events)[0]?.request).toBeNull();
  });
});

describe("downsampleReadings", () => {
  test("a run with fewer readings than the limit keeps them all", () => {
    const readings = [reading(0, "p1", GIB), reading(1, "p1", 2 * GIB)];

    expect(downsampleReadings(readings)).toEqual(readings);
  });

  test("a long run keeps at most the limit, with each stretch's peaks", () => {
    const readings = Array.from({ length: 4_000 }, (_, index) =>
      reading(index * 0.5, "p1", index === 2_345 ? 90 * GIB : 4 * GIB, index === 777 ? 12 : 1),
    );

    const kept = downsampleReadings(readings);

    expect(kept.length).toBeLessThanOrEqual(READING_LIMIT);
    expect(Math.max(...kept.map((item) => item.memory_peak_bytes ?? 0))).toBe(90 * GIB);
    expect(Math.max(...kept.map((item) => item.memory_bytes ?? 0))).toBe(90 * GIB);
    expect(Math.max(...kept.map((item) => item.cpu_cores ?? 0))).toBe(12);
    expect(kept.map((item) => item.time_ms)).toEqual([...kept.map((item) => item.time_ms)].sort((a, b) => a - b));
  });

  test("a kept reading never mixes two producers' readings", () => {
    const readings = [
      ...Array.from({ length: 1_001 }, (_, index) => reading(index * 0.5, "first", GIB)),
      ...Array.from({ length: 1_001 }, (_, index) => reading(600 + index * 0.5, "second", 2 * GIB)),
    ];

    for (const item of downsampleReadings(readings, 100)) {
      expect(item.memory_bytes).toBe(item.producer_id === "first" ? GIB : 2 * GIB);
    }
  });
});

describe("readingRuns", () => {
  test("a chart's series breaks at a sleep, at another producer and at a gap of 5 minutes or more", () => {
    const readings = [
      reading(0, "p1", GIB),
      reading(1, "p1", GIB),
      // A sleep from 1.5 to 2.5.
      reading(3, "p1", GIB),
      reading(4, "p1", GIB),
      // 4 to 10: a gap.
      reading(10, "p1", GIB),
      reading(11, "p2", GIB),
    ];
    const sleeps = [{ start_ms: at(1.5), end_ms: at(2.5), estimated: false, producer_id: "p1" }];

    expect(readingRuns(readings, sleeps).map((run) => run.map((item) => (item.time_ms - T0) / MINUTE))).toEqual([
      [0, 1],
      [3, 4],
      [10],
      [11],
    ]);
  });
});

describe("limits", () => {
  const machine = (overrides: Partial<MachineSegment>): MachineSegment => ({
    producer_id: "p1",
    start_ms: at(0),
    end_ms: at(1),
    kind: "local",
    os: null,
    os_version: null,
    cpu_model: null,
    logical_cpus: 10,
    memory_total_bytes: 32 * GIB,
    cgroup_cpu_limit_cores: null,
    cgroup_memory_limit_bytes: null,
    modal_task_id: null,
    modal_region: null,
    request: null,
    ...overrides,
  });

  test("memory is measured against a Modal request, else the cgroup limit, else the machine's total", () => {
    const request = { resource_class: "heavy", cpu: 4, cpu_limit: null, memory_bytes: 128 * GIB };

    expect(memoryLimitBytes(machine({ request, cgroup_memory_limit_bytes: 200 * GIB }))).toBe(128 * GIB);
    expect(memoryLimitBytes(machine({ cgroup_memory_limit_bytes: 16 * GIB }))).toBe(16 * GIB);
    expect(memoryLimitBytes(machine({}))).toBe(32 * GIB);
  });

  test("CPU is a share of a Modal request's cores, else the cgroup limit, else the machine's cores", () => {
    const request = { resource_class: "heavy", cpu: 4, cpu_limit: null, memory_bytes: 128 * GIB };

    expect(availableCores(machine({ request, cgroup_cpu_limit_cores: 20 }))).toBe(4);
    expect(availableCores(machine({ cgroup_cpu_limit_cores: 6 }))).toBe(6);
    expect(availableCores(machine({}))).toBe(10);
  });
});
