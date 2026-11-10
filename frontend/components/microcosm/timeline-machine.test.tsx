import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { BuildForecast, BuildTimeline } from "@/lib/microcosm/build-monitor";
import type { MachineReading, MachineSegment, SleepBand } from "@/lib/microcosm/machine-readings";
import { NO_FOCUS, type TimelineFocus } from "@/lib/microcosm/timeline-focus";
import { readingSummary, TimelineView } from "./build-monitor-view";

// The Timeline's build machine parts (microcosm-emitter 0.14.0 and later):
// sleeps, memory and CPU charts on the stages' time axis with the machine
// each reading came from, and stages nested in their recorded parent.

const GIB = 1024 ** 3;
const at = (minute: number) => Date.parse("2026-11-09T10:00:00Z") + minute * 60_000;
const UTC = { timeZone: "UTC", locale: "en-US" };

// 80 minutes: 30 loading inputs on a workstation, then 50 calibrating in a
// Modal container.
const STAGES = [
  ["load_inputs", "setup", 0, 30],
  ["calibrate", "calibrate", 30, 80],
] as const;

const span = (stage: string, phase: string, depth: number, start: number, end: number) => ({
  stage,
  phase,
  depth,
  start_ms: at(start),
  end_ms: at(end),
  status: "completed",
  is_gate: false,
  progress: [],
  work: null,
  resources_start: null,
  resources_end: null,
  failures: [],
  message: null,
  refused: false,
});

const LOCAL: MachineSegment = {
  producer_id: "workstation",
  start_ms: at(0),
  end_ms: at(30),
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
};

const MODAL: MachineSegment = {
  producer_id: "container",
  start_ms: at(30),
  end_ms: at(80),
  kind: "modal_container",
  os: "Linux",
  os_version: "4.4.0",
  cpu_model: "AMD EPYC",
  logical_cpus: 64,
  memory_total_bytes: 512 * GIB,
  cgroup_cpu_limit_cores: null,
  cgroup_memory_limit_bytes: null,
  modal_task_id: "ta-01",
  modal_region: "us-east",
  request: { resource_class: "heavy", cpu: 4, cpu_limit: null, memory_bytes: 128 * GIB },
};

const reading = (minute: number, producer: string, memory: number, cores: number, stages: string[]): MachineReading => ({
  time_ms: at(minute),
  first_reading_ms: at(minute),
  producer_id: producer,
  stages,
  memory_bytes: memory,
  memory_peak_bytes: memory,
  cpu_cores: cores,
  machine_cpu_share: 0.3,
  memory_available_bytes: 10 * GIB,
});

const READINGS = [
  ...[1, 2, 3, 4, 5].map((minute) => reading(minute, "workstation", 3 * GIB, 2, ["load_inputs"])),
  ...[31, 32, 33, 60, 61].map((minute) => reading(minute, "container", 40 * GIB, 4, ["calibrate", "solve_weights"])),
];

const SLEEPS: SleepBand[] = [
  // An earlier attempt, from before readings, whose sleep is estimated.
  { start_ms: at(10), end_ms: at(20), estimated: true, producer_id: "earlier" },
  { start_ms: at(35), end_ms: at(55), estimated: false, producer_id: "container" },
];

function run(overrides: Partial<BuildTimeline> = {}): BuildTimeline {
  return {
    run_id: "run",
    state: "passed",
    started_ms: at(0),
    ended_ms: at(80),
    updated_ms: at(80),
    solver_passes: [],
    spans: [
      span("load_inputs", "setup", 0, 0, 30),
      span("calibrate", "calibrate", 0, 30, 80),
      span("solve_weights", "calibrate", 1, 32, 78),
    ],
    readings: READINGS,
    sleeps: SLEEPS,
    machines: [LOCAL, MODAL],
    ...overrides,
  } as unknown as BuildTimeline;
}

const FORECAST = {
  elapsed_ms: 80 * 60_000,
  finish_p50_ms: null,
  finish_p90_ms: null,
  stages: STAGES.map(([stage, phase, start, end]) => ({
    stage,
    phase,
    status: "done",
    basis: "observed",
    start_offset_ms: start * 60_000,
    end_offset_ms: end * 60_000,
  })),
} as unknown as BuildForecast;

function timeline(
  options: { run?: BuildTimeline; expanded?: boolean; chartsOpen?: boolean; focus?: Partial<TimelineFocus> } = {},
): string {
  return renderToStaticMarkup(
    createElement(TimelineView, {
      run: options.run ?? run(),
      forecast: FORECAST,
      nowMs: at(90),
      zone: UTC,
      expanded: options.expanded ?? false,
      chartsExpanded: options.chartsOpen ?? false,
      focus: { ...NO_FOCUS, ...options.focus },
      onToggleExpanded: () => {},
      onToggleCharts: () => {},
      onHoverPhase: () => {},
      onTogglePhase: () => {},
      onToggleStage: () => {},
      onHoverStage: () => {},
    }),
  );
}

// The `style` of each element with `data-sleep` set to `kind`.
function sleepStyles(markup: string, kind: "recorded" | "estimated"): string[] {
  return [...markup.matchAll(new RegExp(`<div[^>]*data-sleep="${kind}"[^>]*>`, "g"))].map(
    (match) => match[0].match(/style="([^"]*)"/)?.[1] ?? "",
  );
}

test("the Whole run bar shades each sleep where it happened, an estimated one drawn apart", () => {
  const markup = timeline();

  // 35 to 55 of the 81.6-minute axis (80 minutes and 2% to spare).
  expect(sleepStyles(markup, "recorded")[0]).toContain("left:42.8");
  expect(sleepStyles(markup, "recorded")[0]).toContain("width:24.5");
  expect(sleepStyles(markup, "estimated")).toHaveLength(1);
  expect(markup).toMatch(/title="Asleep: 20 min, 10:35 AM UTC to 10:55 AM UTC"/);
  expect(markup).toMatch(/title="Asleep \(estimated\): 10 min, 10:10 AM UTC to 10:20 AM UTC"/);
});

test("no Machine row is drawn; the Whole run hover text of each stage names its machine instead", () => {
  const markup = timeline({ chartsOpen: true });

  expect(markup).not.toContain(">Machine<");
  expect(markup).not.toMatch(/>[^<]*macOS 26\.3 · Apple M1 Max/);
  expect(markup).not.toMatch(/>[^<]*Modal heavy · 4 CPU/);
  expect(markup).toContain('title="Calibrate: 50 min\nModal heavy · 4 CPU · 137 GB · us-east · ta-01"');
});

test("a machine that sent no readings is still named, in the hover text of the stages it ran", () => {
  // A Modal attempt that fails before its first reading, 30 seconds in.
  const markup = timeline({ run: run({ readings: [], sleeps: [] }) });

  expect(markup).toContain('title="Load inputs: 30 min\nmacOS 26.3 · Apple M1 Max · 10 CPU · 34 GB"');
  expect(markup).toContain('title="Calibrate: 50 min\nModal heavy · 4 CPU · 137 GB · us-east · ta-01"');
});

test("Memory and CPU sit under a caret below the stages, closed until it is opened", () => {
  const closed = timeline();

  expect(closed).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="Show memory and CPU"/);
  expect(closed).toContain(">Memory and CPU<");
  expect(closed).not.toContain('aria-label="Memory"');
  expect(closed).not.toContain('aria-label="CPU"');
  expect(closed).not.toContain("data-series=");

  const open = timeline({ chartsOpen: true });
  expect(open).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-label="Hide memory and CPU"/);
  expect(open).toContain('aria-label="Memory"');
  expect(open).toContain('aria-label="CPU"');
});

test("with the charts closed, their legend and the time axis are hidden; opening them shows both", () => {
  for (const expanded of [false, true]) {
    const closed = timeline({ expanded });
    expect(closed).not.toContain(">Asleep<");
    expect(closed).not.toContain(">Asleep (estimated)<");
    expect(closed).not.toContain(">Build<");
    expect(closed).not.toContain(">Machine CPU<");
    expect(closed).not.toContain(">Limit<");
    expect(closed).not.toContain("data-time-axis");
  }

  const open = timeline({ chartsOpen: true });
  expect(open).toContain(">Asleep<");
  expect(open).toContain(">Asleep (estimated)<");
  expect(open).toContain(">Build<");
  expect(open).toContain(">Machine CPU<");
  expect(open).toContain(">Limit<");
  expect(open).toContain("data-time-axis");
});

test("Memory and CPU are charted on the stages' time axis, with the build's limits", () => {
  const markup = timeline({ chartsOpen: true });

  expect(markup).toContain('aria-label="Memory"');
  expect(markup).toContain('aria-label="CPU"');
  // Each chart has a value axis with ticks: memory in GB up to the largest
  // limit, the Modal request (137 GB); CPU in percent of the build's cores.
  const tickLabels = [...markup.matchAll(/<span[^>]*data-y-tick=""[^>]*>([^<]+)</g)].map((match) => match[1]);
  expect(tickLabels).toEqual(["0 GB", "50 GB", "100 GB", "0%", "25%", "50%", "75%", "100%"]);
  expect(markup.match(/<line[^>]*data-grid=""/g)).toHaveLength(8);
  // A line per stretch of readings: the workstation's, then the container's
  // before and after its sleep (35 to 55).
  expect(markup.match(/<polyline[^>]*data-series="build-memory"/g)).toHaveLength(3);
  expect(markup.match(/<polyline[^>]*data-series="build-cpu"/g)).toHaveLength(3);
  expect(markup.match(/data-limit="memory"/g)?.length).toBeGreaterThanOrEqual(1);
});

test("a run from before readings, with no charts to open, shows its estimated sleeps with their legend and the time axis", () => {
  const markup = timeline({
    run: run({ readings: [], machines: [], sleeps: [SLEEPS[0]] }),
  });

  expect(markup).not.toContain('aria-label="Memory"');
  expect(sleepStyles(markup, "estimated")).toHaveLength(1);
  expect(markup).toContain(">Asleep (estimated)<");
  expect(markup).toContain("data-time-axis");
});

test("each chart can be reached from the keyboard", () => {
  const markup = timeline({ chartsOpen: true });

  expect(markup).toMatch(/<div[^>]*tabindex="0"[^>]*aria-label="Memory"/);
  expect(markup).toMatch(/<div[^>]*tabindex="0"[^>]*aria-label="CPU"/);
  // A reading the keyboard picks is read out.
  expect(markup.match(/aria-live="polite"/g)).toHaveLength(2);
});

test("a nested stage is drawn in its top-level stage's type, which its selection and filter follow", () => {
  const markup = timeline({
    expanded: true,
    run: run({
      spans: [
        span("load_inputs", "setup", 0, 0, 30),
        span("calibrate", "calibrate", 0, 30, 80),
        span("load_weights", "setup", 1, 31, 34),
      ] as unknown as BuildTimeline["spans"],
    }),
  });

  expect(markup).toMatch(/background:var\(--phase-calibrate\)[^>]*><\/span><span[^>]*>Load weights</);
});

test("a run without readings has no charts and no caret for them", () => {
  const markup = timeline({ chartsOpen: true, run: run({ readings: [], machines: [], sleeps: [] }) });

  expect(markup).not.toContain(">Memory and CPU<");
  expect(markup).not.toContain('aria-label="Memory"');
  expect(markup).not.toContain('aria-label="CPU"');
  expect(markup).not.toContain("data-sleep=");
});

test("a run from before the timeline had these fields draws as before", () => {
  const markup = timeline({ run: run({ readings: undefined, machines: undefined, sleeps: undefined }) });

  expect(markup).toContain(">Whole run<");
  expect(markup).not.toContain('aria-label="Memory"');
});

test("the breakdown shows each stage's nested stages under it", () => {
  const markup = timeline({ expanded: true });

  const calibrate = markup.indexOf(">Calibrate</");
  const nested = markup.indexOf(">Solve weights</");
  expect(calibrate).toBeGreaterThan(-1);
  expect(nested).toBeGreaterThan(calibrate);
});

test("under a stage-type filter, sleeps and readings keep their place in the shown stages", () => {
  const markup = timeline({ chartsOpen: true, focus: { filter: new Set(["calibrate"]) } });

  // Calibration alone fills the bar: 30 to 80 becomes 0 to 50.
  expect(sleepStyles(markup, "recorded")[0]).toContain("left:10%");
  expect(sleepStyles(markup, "recorded")[0]).toContain("width:40%");
  // The workstation's sleep fell in loading, which the filter hides.
  expect(sleepStyles(markup, "estimated")).toHaveLength(0);
  // The container's two stretches; the workstation's readings were in loading.
  expect(markup.match(/<polyline[^>]*data-series="build-memory"/g)).toHaveLength(2);
});

test("a clicked stage narrows sleeps and readings to it, as a stage-type filter does", () => {
  const markup = timeline({ chartsOpen: true, focus: { selectedStage: "calibrate-1", selectedPhase: "calibrate" } });

  // Calibrate alone fills the bar: 30 to 80 becomes 0 to 50.
  expect(sleepStyles(markup, "recorded")[0]).toContain("left:10%");
  expect(sleepStyles(markup, "recorded")[0]).toContain("width:40%");
  expect(sleepStyles(markup, "estimated")).toHaveLength(0);
  expect(markup.match(/<polyline[^>]*data-series="build-memory"/g)).toHaveLength(2);
});

test("hovering a reading says when it was, the stage, and the build's memory and CPU against its limits, not the machine", () => {
  expect(readingSummary(READINGS[5], MODAL, at(90), UTC)).toEqual([
    "10:31 AM UTC",
    "Calibrate › Solve weights",
    "Memory 43 GB of 137 GB",
    "CPU 4.0 cores, 100% of 4.0",
    "Machine 30% busy",
  ]);
  expect(readingSummary(READINGS[0], LOCAL, at(90), UTC).at(-1)).toBe("Machine 30% busy");
  expect(readingSummary({ ...READINGS[0], cpu_cores: null, machine_cpu_share: null }, null, at(90), UTC)).toEqual([
    "10:01 AM UTC",
    "Load inputs",
    "Memory 3.2 GB",
  ]);
});
