import { describe, expect, test } from "bun:test";

import {
  HEARTBEAT_STALE_MS,
  type BuildRunDocuments,
  type BuildTimeline,
  buildTimeline,
  calibrationRate,
  stopStatistics,
  failureReason,
  forecastCompletion,
  formatStageName,
  gateStatistics,
  isGateStage,
  phaseTotals,
  sameStageSequence,
  solverSegments,
  stageCores,
  stagePhase,
  stageStatistics,
  STALL_MS,
} from "./build-monitor";

const T0 = Date.parse("2026-09-26T10:00:00Z");
const min = (n: number) => n * 60_000;
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

// Version 1: every event is a transition into a stage.
function v1Run(
  runId: string,
  stages: [string, number, string?, Record<string, unknown>?][],
  options: { start?: number; status?: string; end?: [string, number, string?] } = {},
): BuildRunDocuments {
  const start = options.start ?? 0;
  const events: Record<string, unknown>[] = [
    { time: at(start), type: "stage", status: "running", stage: "created", details: {} },
    ...stages.map(([stage, offset, status, details]) => ({
      time: at(start + offset),
      type: "stage",
      status: status ?? "running",
      stage,
      message: null,
      details: details ?? {},
    })),
  ];
  if (options.end) {
    const [stage, offset, message] = options.end;
    events.push({
      time: at(start + offset),
      type: "stage",
      status: stage === "complete" ? "passed" : "failed",
      stage,
      message: message ?? null,
      details: stage === "failed" ? { error_type: "RuntimeError" } : {},
    });
  }
  const last = events[events.length - 1];
  return {
    run_id: runId,
    source: "local",
    country: "us",
    progress: {
      schema_version: 1,
      run_id: runId,
      status: options.status ?? (options.end ? (options.end[0] === "complete" ? "passed" : "failed") : "running"),
      stage: last.stage,
      started_at: at(start),
      updated_at: last.time,
    },
    run_manifest: null,
    calibration_progress: null,
    events,
  };
}

const PASSED_STAGES: [string, number][] = [
  ["target_registry", 0],
  ["load_base_frame", min(1)],
  ["source_inputs", min(2)],
  ["target_compilation", min(10)],
  ["calibrating", min(70)],
  ["export_dataset", min(80)],
  ["manifests", min(85)],
];

function passedRun(runId: string, start: number, scale = 1): BuildRunDocuments {
  return v1Run(
    runId,
    PASSED_STAGES.map(([stage, offset]) => [stage, offset * scale]),
    { start, end: ["complete", min(90) * scale] },
  );
}

describe("buildTimeline, version 1 transitions", () => {
  test("each stage lasts until the next transition", () => {
    const run = buildTimeline(passedRun("a", 0), T0 + min(200));
    expect(run.state).toBe("passed");
    expect(run.pipeline).toBe("US:release-v1");
    expect(run.spans.map((span) => span.stage)).toEqual(PASSED_STAGES.map(([stage]) => stage));
    const compile = run.spans.find((span) => span.stage === "target_compilation")!;
    expect(compile.end_ms! - compile.start_ms).toBe(min(60));
    expect(compile.phase).toBe("compile");
    expect(run.ended_ms).toBe(T0 + min(90));
  });

  test("a failing gate carries its failures and the terminal error", () => {
    const run = buildTimeline(
      v1Run(
        "b",
        [
          ["load_base_frame", 0],
          ["qbi_input_gate", min(5), "failed", { failures: ["QBI signal failed: zero support"] }],
        ],
        { end: ["failed", min(5) + 1000, "Release gates failed: QBI"] },
      ),
      T0 + min(10),
    );
    expect(run.state).toBe("failed");
    const gate = run.spans.find((span) => span.stage === "qbi_input_gate")!;
    expect(gate.status).toBe("failed");
    expect(gate.is_gate).toBe(true);
    expect(gate.failures).toEqual(["QBI signal failed: zero support"]);
    expect(run.failure).toEqual({
      stage: "qbi_input_gate",
      message: "Release gates failed: QBI",
      error_type: "RuntimeError",
      error_code: null,
      failure_class: null,
      diagnostic_reference: null,
    });
  });

  test("re-entering the same stage extends it instead of adding a row", () => {
    const run = buildTimeline(
      v1Run("c", [
        ["release_gates", 0],
        ["release_gates", min(1)],
        ["export_dataset", min(2)],
      ]),
      T0 + min(3),
    );
    expect(run.spans.map((span) => span.stage)).toEqual(["release_gates", "export_dataset"]);
    expect(run.spans[1].end_ms).toBeNull();
    expect(run.current_stage).toBe("export_dataset");
  });

  test("a run silent for longer than the stall limit is stalled and its stage closed", () => {
    const run = buildTimeline(v1Run("d", [["target_compilation", min(1)]]), T0 + min(1) + STALL_MS + 1);
    expect(run.state).toBe("stalled");
    expect(run.spans[0].end_ms).toBe(T0 + min(1));
  });
});

describe("buildTimeline, version 2 lifecycle", () => {
  function v2Event(sequence: number, offset: number, stage: string, status: string, extra: Record<string, unknown> = {}) {
    return {
      schema_version: 2,
      sequence,
      run_id: "uk-1",
      event_type: extra.event_type ?? "stage",
      stage,
      stage_id: stage,
      status,
      time: at(offset),
      timestamp: at(offset),
      message: (extra.message as string) ?? null,
      details: (extra.details as Record<string, unknown>) ?? {},
    };
  }

  const documents: BuildRunDocuments = {
    run_id: "uk-1",
    source: "staging",
    country: "uk",
    progress: {
      schema_version: 2,
      run_id: "uk-1",
      country_code: "GB",
      pipeline: { id: "uk-frs-calibration", version: "0.1.0" },
      started_at: at(0),
      updated_at: at(min(9)),
      status: "running",
      current_stage: "solver_execution",
    },
    run_manifest: null,
    calibration_progress: {
      events: [
        { epoch: 10, epochs: 100, loss: 0.2, time: at(min(8)) },
        { epoch: 20, epochs: 100, loss: 0.1, time: at(min(8) + 10_000) },
        { epoch: 30, epochs: 100, loss: 0.05, time: at(min(8) + 20_000) },
      ],
    },
    events: [
      v2Event(1, 0, "created", "started"),
      v2Event(2, 1000, "input_pinning", "completed"),
      v2Event(3, 2000, "target_compilation", "started"),
      v2Event(4, min(6), "target_compilation", "completed"),
      v2Event(5, min(6), "calibration", "started"),
      v2Event(6, min(7), "solver_execution", "started"),
      v2Event(7, min(8), "calibrating", "progress", {
        event_type: "calibration",
        details: { epoch: 10 },
      }),
    ],
  };

  test("nests stages and skips calibration progress events", () => {
    const run = buildTimeline(documents, T0 + min(9));
    expect(run.pipeline).toBe("GB:uk-frs-calibration");
    expect(run.pipeline_label).toBe("UK FRS calibration");
    expect(run.spans.map((span) => [span.stage, span.depth])).toEqual([
      ["input_pinning", 0],
      ["target_compilation", 0],
      ["calibration", 0],
      ["solver_execution", 1],
    ]);
    // A completion without a start is instantaneous.
    expect(run.spans[0].end_ms).toBe(run.spans[0].start_ms);
    expect(run.current_stage).toBe("calibration");
  });

  test("uses observer elapsed time for completion-only graph nodes", () => {
    const run = buildTimeline(
      {
        ...documents,
        events: [
          v2Event(1, 0, "created", "started"),
          v2Event(2, min(3), "uk.full.target_selection", "completed", {
            event_type: "stage",
            details: { done: 4, total: 10, elapsed_seconds: 30 },
          }),
        ],
      },
      T0 + min(3),
    );

    expect(run.spans[0].end_ms! - run.spans[0].start_ms).toBe(30_000);
    expect(run.spans[0].progress).toEqual([
      { done: 4, total: 10, time_ms: T0 + min(3) },
    ]);
  });

  test("keeps smoke runs apart from full runs of the same pipeline", () => {
    const smoke = buildTimeline(
      { ...documents, progress: { ...documents.progress!, run_kind: "smoke" } },
      T0 + min(9),
    );
    expect(smoke.pipeline).toBe("GB:uk-frs-calibration:smoke");
    expect(smoke.pipeline_label).toBe("UK FRS calibration (smoke)");
  });

  test("reads the solver rate from calibration progress", () => {
    const run = buildTimeline(documents, T0 + min(9));
    const rate = calibrationRate(run.calibration)!;
    expect(rate.seconds_per_epoch).toBe(1);
    expect(rate.remaining_ms).toBe(70_000);
  });

  test("a restarted epoch counter starts a new solver pass", () => {
    const run = buildTimeline(
      {
        ...documents,
        calibration_progress: {
          events: [
            { epoch: 90, epochs: 100, loss: 0.1, time: at(0) },
            { epoch: 10, epochs: 100, loss: 0.2, time: at(1000) },
          ],
        },
      },
      T0 + min(9),
    );
    expect(run.calibration.map((point) => point.pass)).toEqual([0, 1]);
  });
});

describe("gate refusals in completed version 2 runs", () => {
  function completedRun(details: Record<string, unknown>): BuildRunDocuments {
    const event = (sequence: number, offset: number, stage: string, status: string, extra: Record<string, unknown> = {}) => ({
      schema_version: 2,
      sequence,
      run_id: "uk-2",
      event_type: "stage",
      stage,
      stage_id: stage,
      status,
      time: at(offset),
      message: null,
      details: extra,
    });
    return {
      run_id: "uk-2",
      source: "local",
      country: "uk",
      progress: {
        schema_version: 2,
        run_id: "uk-2",
        country_code: "GB",
        pipeline: { id: "uk-local-candidate", version: "0.1.0" },
        started_at: at(0),
        updated_at: at(min(10)),
        status: "completed",
        current_stage: "complete",
      },
      run_manifest: null,
      calibration_progress: null,
      events: [
        event(1, 0, "created", "started"),
        event(2, min(1), "gate_battery", "started"),
        event(3, min(2), "gate_battery", "completed", details),
        event(4, min(10), "complete", "completed"),
      ],
    };
  }

  test("a completed run whose gate battery refused is blocked", () => {
    const run = buildTimeline(
      completedRun({ blocking_failure_count: 2, gate_statuses: { coverage: "failed", fit: "passed", loss: "blocked" } }),
      T0 + min(11),
    );
    expect(run.state).toBe("blocked");
    expect(run.failure?.stage).toBe("gate_battery");
    expect(run.spans[0].failures).toEqual(["coverage: failed", "loss: blocked"]);
  });

  test("a clean gate battery leaves the run finished", () => {
    const run = buildTimeline(completedRun({ blocking_failure_count: 0 }), T0 + min(11));
    expect(run.state).toBe("passed");
  });
});

describe("stage classification", () => {
  test("gates, phases and labels", () => {
    expect(isGateStage("release_gates")).toBe(true);
    expect(isGateStage("base_frame_spm_composition")).toBe(true);
    expect(isGateStage("reform_coverage_smoke")).toBe(true);
    expect(isGateStage("target_registry")).toBe(false);
    expect(stagePhase("scf_wealth_inputs")).toBe("setup");
    expect(stagePhase("target_compilation")).toBe("compile");
    expect(stagePhase("size_search")).toBe("calibrate");
    expect(stagePhase("candidate_h5_creation")).toBe("export");
    expect(formatStageName("hmrc_spi_income_spine")).toBe("HMRC SPI income spine");
  });

  test("groups batched failure lines by their check", () => {
    expect(failureReason("Export input mass failed: farm_income -79.9%")).toBe("Export input mass failed");
  });
});

describe("forecastCompletion", () => {
  const history = [passedRun("h1", -min(1000)), passedRun("h2", -min(800)), passedRun("h3", -min(600))].map(
    (documents) => buildTimeline(documents, T0),
  );

  test("a finished run has nothing left", () => {
    const run = history[0];
    const forecast = forecastCompletion(run, history, T0)!;
    expect(forecast.method).toBe("finished");
    expect(forecast.remaining_p50_ms).toBe(0);
  });

  test("forecasts from the point comparable runs reached the current stage", () => {
    // 20 minutes into a 60-minute target compilation that started at 10 min.
    const live = buildTimeline(
      v1Run("live", PASSED_STAGES.slice(0, 4) as [string, number][]),
      T0 + min(30),
    );
    const forecast = forecastCompletion(live, history, T0 + min(30))!;
    expect(forecast.method).toBe("milestone");
    expect(forecast.basis_runs).toHaveLength(3);
    // 40 min of compilation left plus 20 min after it.
    expect(forecast.remaining_p50_ms).toBe(min(60));
    expect(forecast.remaining_p90_ms!).toBeGreaterThanOrEqual(min(60) * 1.3);
    expect(forecast.fraction_complete).toBeCloseTo(30 / 90);
    expect(forecast.stages.at(-1)!.stage).toBe("manifests");
    expect(forecast.stages.filter((stage) => stage.status === "pending").map((stage) => stage.stage)).toEqual([
      "calibrating",
      "export_dataset",
      "manifests",
    ]);
  });

  test("a slow run scales what is left", () => {
    // Finished stages took twice their typical time.
    const live = buildTimeline(
      v1Run("slow", PASSED_STAGES.slice(0, 5).map(([stage, offset]) => [stage, offset * 2]) as [string, number][]),
      T0 + min(150),
    );
    const forecast = forecastCompletion(live, history, T0 + min(150))!;
    expect(forecast.pace).toBeCloseTo(2);
    // Calibration (10 min typical) started 10 min ago at double pace: its
    // remaining is conditional on past durations, and the 10 min after it
    // doubles to 20.
    expect(forecast.remaining_p50_ms!).toBeGreaterThanOrEqual(min(20));
  });

  test("an overrunning stage is flagged instead of reaching zero", () => {
    const live = buildTimeline(
      v1Run("over", PASSED_STAGES.slice(0, 4) as [string, number][]),
      T0 + min(100),
    );
    const forecast = forecastCompletion(live, history, T0 + min(100))!;
    expect(forecast.overrunning).toBe(true);
    expect(forecast.remaining_p50_ms!).toBeGreaterThan(min(20));
    expect(forecast.note).toContain("longer than in any comparable run");
  });

  test("a stalled run's elapsed time ends at its last sign of life", () => {
    const stalled = buildTimeline(
      v1Run("silent", [
        ["load_base_frame", 0],
        ["target_compilation", min(10)],
      ]),
      T0 + 90 * 24 * 60 * 60 * 1000,
    );
    expect(stalled.state).toBe("stalled");
    const forecast = forecastCompletion(stalled, history, T0 + 90 * 24 * 60 * 60 * 1000)!;
    expect(forecast.elapsed_ms).toBe(min(10));
  });

  test("says so when there is no history", () => {
    const live = buildTimeline(v1Run("alone", [["load_base_frame", 0]]), T0 + min(1));
    const forecast = forecastCompletion(live, [], T0 + min(1))!;
    expect(forecast.method).toBe("none");
    expect(forecast.remaining_p50_ms).toBeNull();
    expect(forecast.note).toContain("No finished run of this pipeline");
  });
});

describe("in-stage progress", () => {
  test("a stage reporting batches gets a measured remaining time", () => {
    const run = buildTimeline(
      v1Run("work", [
        ["target_compilation", 0],
        ["target_compilation", min(10), "running", { batch: 10, batches: 100 }],
        ["target_compilation", min(20), "running", { batch: 20, batches: 100 }],
      ]),
      T0 + min(20),
    );
    expect(run.spans).toHaveLength(1);
    expect(run.spans[0].progress.map((point) => point.done)).toEqual([10, 20]);
    const forecast = forecastCompletion(run, [], T0 + min(20))!;
    expect(forecast.method).toBe("rate_only");
    expect(forecast.stage_work).toEqual({ done: 20, total: 100, remaining_ms: min(80) });
    expect(forecast.remaining_p50_ms).toBe(min(80));
  });
});

describe("cross-run statistics", () => {
  const failed = buildTimeline(
    v1Run(
      "f",
      [
        ["target_compilation", 0],
        ["calibrating", min(60)],
        [
          "release_gates",
          min(70),
          "failed",
          { failures: ["QRF tail concentration failed: bond_assets", "QRF tail concentration failed: farm_income"] },
        ],
      ],
      { end: ["failed", min(71)] },
    ),
    T0 + min(100),
  );
  const runs: BuildTimeline[] = [buildTimeline(passedRun("p", -min(500)), T0), failed];

  test("stage statistics count completed stages of failed runs", () => {
    const stats = stageStatistics(runs);
    const compile = stats.find((stat) => stat.stage === "target_compilation")!;
    expect(compile.samples).toBe(2);
    expect(compile.median_ms).toBe(min(60));
    expect(stats.find((stat) => stat.stage === "release_gates")!.failures).toBe(1);
  });

  test("a stage cut short by a failure or a stall has no finished time", () => {
    const stalled = buildTimeline(
      v1Run("s", [["target_compilation", 0]], { status: "running" }),
      T0 + STALL_MS + min(1),
    );
    expect(stalled.state).toBe("stalled");
    const stats = stageStatistics([...runs, stalled]);
    const gates = stats.find((stat) => stat.stage === "release_gates")!;
    expect(gates.finished_median_ms).toBeNull();
    expect(gates.cut_short).toBe(1);
    // A stage no run finished takes no share of the typical run.
    expect(gates.share).toBe(0);
    const compile = stats.find((stat) => stat.stage === "target_compilation")!;
    // The stalled run's 0-minute compilation counts in the median only.
    expect(compile.samples).toBe(3);
    expect(compile.cut_short).toBe(1);
    expect(compile.finished_median_ms).toBe(min(60));
  });

  test("gate statistics measure compute lost and group reasons", () => {
    const [gate] = gateStatistics(runs);
    expect(gate.gate).toBe("release_gates");
    expect(gate.failures).toBe(1);
    expect(gate.median_offset_ms).toBe(min(70));
    expect(gate.reasons).toEqual([{ reason: "QRF tail concentration failed", count: 2 }]);
  });

  test("phase totals add up the run", () => {
    const totals = phaseTotals(runs[0], T0);
    expect(totals.total_ms).toBe(min(90));
    // Target registry (1 min) and target compilation (60 min).
    expect(totals.phases.compile).toBe(min(61));
  });
});


describe("process telemetry (resources, work, heartbeat, failure class)", () => {
  const resources = (cpu: number, rss: number) => ({
    cpu_user_seconds: cpu,
    cpu_system_seconds: 0,
    rss_bytes: rss,
    peak_rss_bytes: rss,
  });
  function instrumented(extra: Record<string, unknown> = {}): BuildRunDocuments {
    const events = [
      { time: at(0), type: "stage", status: "running", stage: "created", details: {} },
      { time: at(0), type: "stage", status: "running", stage: "load_base_frame", details: {}, resources: resources(0, 2e9) },
      { time: at(min(10)), type: "stage", status: "running", stage: "target_compilation", details: {}, resources: resources(3000, 9e9) },
    ];
    return {
      run_id: "inst",
      source: "local",
      country: "us",
      progress: {
        schema_version: 1,
        run_id: "inst",
        status: "running",
        stage: "target_compilation",
        started_at: at(0),
        updated_at: at(min(10)),
        heartbeat_at: at(min(40)),
        resources: resources(4800, 12e9),
        work: {
          stage: "target_compilation",
          done: 531,
          total: 2124,
          unit: "engine batch",
          elapsed_seconds: 1800,
          updated_at: at(min(40)),
          details: { pass_name: "base" },
        },
        ...extra,
      },
      run_manifest: {
        schema_version: 1,
        run_id: "inst",
        identity: { git_commit: "3598c38d", host: { cpu_count: 18, memory_bytes: 128e9, platform: "macOS" }, runtime: { "policyengine-us": "2.2.1" } },
      },
      calibration_progress: null,
      events,
    };
  }

  test("a stage's cores come from CPU seconds over wall seconds", () => {
    const run = buildTimeline(instrumented(), T0 + min(40));
    const [load, compile] = run.spans;
    // 3,000 CPU seconds over 600 s: five cores busy while loading.
    expect(stageCores(load)).toBeCloseTo(5);
    // The open stage uses the heartbeat: 1,800 CPU seconds over 1,800 s.
    expect(stageCores(compile)).toBeCloseTo(1);
    expect(run.identity?.cpu_count).toBe(18);
    expect(run.identity?.git_commit).toBe("3598c38d");
  });

  test("reported batches give the current stage a measured remaining time", () => {
    const run = buildTimeline(instrumented(), T0 + min(40));
    expect(run.spans[1].work?.done).toBe(531);
    const forecast = forecastCompletion(run, [], T0 + min(40))!;
    // 1,800 s for 531 batches, 1,593 left: about 5,400 s.
    expect(forecast.stage_work?.remaining_ms).toBeCloseTo((1800 * 1000 * 1593) / 531, -3);
    expect(forecast.method).toBe("rate_only");
  });

  test("measured batches outrank history for the current stage", () => {
    const history = [passedRun("h1", -min(1000)), passedRun("h2", -min(800))].map((documents) =>
      buildTimeline(documents, T0),
    );
    // Target compilation started at 10 min; 30 of 40 batches done in 30 s,
    // where comparable runs took 60 min for the whole stage.
    const live = buildTimeline(
      {
        ...v1Run("fast", PASSED_STAGES.slice(0, 4) as [string, number][]),
        progress: {
          schema_version: 1,
          run_id: "fast",
          status: "running",
          stage: "target_compilation",
          started_at: at(0),
          updated_at: at(min(10) + 30_000),
          work: {
            stage: "target_compilation",
            done: 30,
            total: 40,
            unit: "engine batch",
            elapsed_seconds: 30,
            updated_at: at(min(10) + 30_000),
            details: {},
          },
        },
      },
      T0 + min(10) + 30_000,
    );
    const forecast = forecastCompletion(live, history, T0 + min(10) + 30_000)!;
    // 10 s of compilation left, then the 20 min comparable runs took after it.
    expect(forecast.remaining_p50_ms).toBe(10_000 + min(20));
    expect(forecast.overrunning).toBe(false);
  });

  test("a missed heartbeat marks the run stalled within minutes", () => {
    const alive = buildTimeline(instrumented(), T0 + min(42));
    expect(alive.state).toBe("running");
    const dead = buildTimeline(instrumented(), T0 + min(40) + HEARTBEAT_STALE_MS + 1);
    expect(dead.state).toBe("stalled");
  });

  test("stops are grouped by how and where runs ended, with only what they recorded", () => {
    const failed = buildTimeline(
      v1Run("gate", [["release_gates", 0]], { end: ["failed", min(200), "Release gates failed: x"] }),
      T0 + min(300),
    );
    failed.failure = { ...failed.failure!, failure_class: "gate_refused" };
    // Went silent 30 minutes in, with no final event.
    const stalled = buildTimeline(
      v1Run("quiet", [
        ["load_base_frame", 0],
        ["target_compilation", min(30)],
      ]),
      T0 + min(30) + STALL_MS + min(1),
    );
    const stops = stopStatistics([failed, stalled, buildTimeline(passedRun("ok", 0), T0)]);
    expect(stops.map((stop) => [stop.outcome, stop.stage, stop.runs])).toEqual([
      ["failed", "release_gates", 1],
      ["stalled", "target_compilation", 1],
    ]);
    expect(stops[0].median_time_at_stop_ms).toBe(min(200));
    expect(stops[0].error_types).toEqual([{ value: "RuntimeError", count: 1 }]);
    expect(stops[0].failure_classes).toEqual([{ value: "gate_refused", count: 1 }]);
    expect(stops[0].reasons).toEqual([{ value: "Release gates failed", count: 1 }]);
    // A silent run reports nothing, and nothing is made up for it.
    expect(stops[1].unexplained).toBe(1);
    expect(stops[1].error_types).toEqual([]);
  });

  test("a failure without a recorded class gets none", () => {
    const crash = buildTimeline(
      v1Run("old-crash", [["export_dataset", 0]], { end: ["failed", min(5), "KeyError: 'weights'"] }),
      T0 + min(10),
    );
    const [stop] = stopStatistics([crash]);
    expect(stop.failure_classes).toEqual([]);
    expect(stop.error_types).toEqual([{ value: "RuntimeError", count: 1 }]);
    expect(stop.unexplained).toBe(0);
  });

  test("a version 2 failure keeps its error code and where the details are", () => {
    const run = buildTimeline(
      {
        run_id: "uk-failed",
        source: "staging",
        country: "uk",
        progress: {
          schema_version: 2,
          run_id: "uk-failed",
          country_code: "GB",
          pipeline: { id: "uk-local-candidate", version: "0.1.0" },
          started_at: at(0),
          updated_at: at(min(30)),
          status: "failed",
          failure: {
            error_code: "BUILD_FAILED",
            error_type: "NodeRejectedError",
            message: "The build failed during target_compilation.",
            local_diagnostic_reference: "logs/uk-failed.txt",
          },
        },
        run_manifest: null,
        calibration_progress: null,
        events: [
          { schema_version: 2, sequence: 1, event_type: "stage", stage_id: "target_compilation", status: "started", timestamp: at(0), details: {} },
          { schema_version: 2, sequence: 2, event_type: "stage", stage_id: "target_compilation", status: "failed", timestamp: at(min(30)), details: {} },
        ],
      },
      T0 + min(31),
    );
    expect(run.failure).toMatchObject({
      stage: "target_compilation",
      error_type: "NodeRejectedError",
      error_code: "BUILD_FAILED",
      diagnostic_reference: "logs/uk-failed.txt",
    });
    const [stop] = stopStatistics([run]);
    expect(stop.error_codes).toEqual([{ value: "BUILD_FAILED", count: 1 }]);
  });
});


describe("delivery to the staging repository", () => {
  test("a version 1 run that failed its write check is flagged local only", () => {
    const documents = v1Run("local", [["target_compilation", 0]]);
    documents.run_manifest = {
      schema_version: 1,
      run_id: "local",
      delivery_check: {
        uploads: "local_only",
        repository: "policyengine/populace-us-staging",
        reason: "no Hugging Face token is configured",
      },
    };
    const run = buildTimeline(documents, T0 + min(1));
    expect(run.delivery).toEqual({
      uploads: "local_only",
      repository: "policyengine/populace-us-staging",
      reason: "no Hugging Face token is configured",
      attempts: null,
      successes: null,
    });
  });

  test("a version 2 run reports what reached the repository", () => {
    const run = buildTimeline(
      {
        ...v1Run("uk", [["calibration", 0]]),
        progress: {
          schema_version: 2,
          run_id: "uk",
          status: "running",
          current_stage: "calibration",
          started_at: at(0),
          updated_at: at(min(1)),
          delivery: {
            mode: "local_and_remote",
            enabled: true,
            configured_repository: "policyengine/populace-uk-staging",
            upload_attempts: 3,
            upload_successes: 0,
            last_error_code: "UPLOAD_FAILED",
            opt_out_reason: null,
          },
        },
      },
      T0 + min(1),
    );
    expect(run.delivery?.uploads).toBe("local_only");
    expect(run.delivery?.reason).toBe("last upload error: UPLOAD_FAILED");
  });
});

describe("solver passes inside calibration", () => {
  interface PassSpec {
    phase?: string;
    // Epoch 0, measured from the start of the run.
    start: number;
    msPerEpoch: number;
    epochs: number;
    // The last logged epoch; defaults to all of them.
    upTo?: number;
  }

  // A version 2 run: top-level stages as [stage, start, end] offsets (end
  // null while it runs) and solver passes logged every 10 epochs.
  function ukRun(
    runId: string,
    start: number,
    stages: [string, number, number | null][],
    passes: PassSpec[],
    options: { status?: string; now?: number } = {},
  ): BuildRunDocuments {
    let sequence = 0;
    const event = (offset: number, stage: string, status: string) => ({
      schema_version: 2,
      sequence: ++sequence,
      run_id: runId,
      event_type: "stage",
      stage,
      stage_id: stage,
      status,
      time: at(start + offset),
      timestamp: at(start + offset),
      message: null,
      details: {},
    });
    const events: Record<string, unknown>[] = [event(0, "created", "started")];
    for (const [stage, from, to] of stages) {
      events.push(event(from, stage, "started"));
      if (to != null) events.push(event(to, stage, "completed"));
    }
    const status = options.status ?? "running";
    const last = Math.max(...stages.map(([, from, to]) => to ?? from));
    if (status === "completed") events.push(event(last, "complete", "completed"));
    const rows = passes.flatMap((pass) => {
      const out: Record<string, unknown>[] = [];
      for (let epoch = 10; epoch <= (pass.upTo ?? pass.epochs); epoch += 10) {
        out.push({
          epoch,
          epochs: pass.epochs,
          loss: 1 / epoch,
          phase: pass.phase ?? null,
          time: at(start + pass.start + epoch * pass.msPerEpoch),
        });
      }
      return out;
    });
    return {
      run_id: runId,
      source: "staging",
      country: "uk",
      progress: {
        schema_version: 2,
        run_id: runId,
        country_code: "GB",
        pipeline: { id: "uk-local-candidate", version: "0.1.0" },
        started_at: at(start),
        updated_at: at(start + Math.max(last, ...rows.map((row) => Date.parse(String(row.time)) - T0 - start))),
        status,
      },
      run_manifest: null,
      calibration_progress: { events: rows },
      events,
    };
  }

  const hour = 60 * min(1);
  // A search pass: 100 epochs at 30 s each, 50 min.
  const search = (startOffset: number, extra: Partial<PassSpec> = {}): PassSpec => ({
    phase: "size_search",
    start: startOffset,
    msPerEpoch: 30_000,
    epochs: 100,
    ...extra,
  });

  // The old layout: cloning and surface resolution before calibration, then
  // eight size-search passes and a gate battery.
  function oldLayoutRun(runId: string, start: number, searchPasses: number): BuildRunDocuments {
    const passes = [
      { start: min(20), msPerEpoch: 30_000, epochs: 100 },
      ...Array.from({ length: searchPasses }, (_, index) => search(min(71) + index * min(51))),
    ];
    const calibrationEnd = min(71) + searchPasses * min(51) + min(1);
    return ukRun(
      runId,
      start,
      [
        ["input_pinning", 0, 1000],
        ["target_compilation", 2000, min(5)],
        ["cloning", min(5), min(6)],
        ["surface_resolution", min(6), min(15)],
        ["calibration", min(15), calibrationEnd],
        ["gate_battery", calibrationEnd, calibrationEnd + min(1)],
      ],
      passes,
      { status: "completed" },
    );
  }

  // The new layout: target compilation does the cloning; calibration runs a
  // dense pass, a long stretch without epochs, then size-search passes.
  const NOW = min(16 * 60);
  const live = buildTimeline(
    ukRun(
      "live",
      0,
      [
        ["input_pinning", 0, 1000],
        ["target_compilation", 2000, 2 * hour],
        ["calibration", 2 * hour, null],
      ],
      [
        { start: 2 * hour + min(40), msPerEpoch: 30_000, epochs: 100 },
        search(5 * hour),
        search(5 * hour + min(50) + 20_000),
        search(6 * hour + min(40) + 40_000, { upTo: 30 }),
      ],
    ),
    T0 + 6 * hour + min(56),
  );

  test("passes are back-dated to epoch 0 and keep their phase", () => {
    expect(live.solver_passes.map((pass) => [pass.index, pass.phase, pass.complete])).toEqual([
      [0, null, true],
      [1, "size_search", true],
      [2, "size_search", true],
      [3, "size_search", false],
    ]);
    // The first row is logged at epoch 10, five minutes in.
    expect(live.solver_passes[0].start_ms).toBe(T0 + 2 * hour + min(40));
  });

  test("calibration splits into setup, passes and stretches without epochs", () => {
    const calibration = live.spans.find((span) => span.stage === "calibration")!;
    const segments = solverSegments(calibration, live, T0 + 6 * hour + min(56));
    expect(segments.map((segment) => [segment.kind, segment.label])).toEqual([
      ["before", "Before the first epoch"],
      ["pass", "Solver pass 1"],
      ["between", "No epochs logged"],
      ["pass", "Solver pass 2 · size search"],
      ["pass", "Solver pass 3 · size search"],
      ["pass", "Solver pass 4 · size search"],
    ]);
    expect(segments[0].end_ms! - segments[0].start_ms).toBe(min(40));
    // The 20 s between search passes folds into the next pass.
    expect(segments[4].start_ms).toBe(segments[3].end_ms!);
    // The running pass stays open.
    expect(segments[5].end_ms).toBeNull();
  });

  test("a pass known from one mid-pass row gets no stretch before it", () => {
    const run = buildTimeline(
      ukRun("single", 0, [["calibration", 0, null]], [{ start: hour, msPerEpoch: 30_000, epochs: 100, upTo: 10 }]),
      T0 + 2 * hour,
    );
    expect(run.solver_passes[0].start_known).toBe(false);
    const segments = solverSegments(run.spans[0], run, T0 + 2 * hour);
    expect(segments.map((segment) => segment.kind)).toEqual(["pass"]);
    expect(segments[0].start_ms).toBe(T0);
  });

  test("a pipeline whose stages moved is not compared with its old layout", () => {
    const old = buildTimeline(oldLayoutRun("old", -10 * 24 * hour, 8), T0);
    expect(sameStageSequence(live, old)).toBe(false);
    expect(sameStageSequence(old, live)).toBe(false);
    // A run of the new layout that stopped in target compilation still matches.
    const early = buildTimeline(
      ukRun("early", -24 * hour, [["input_pinning", 0, 1000], ["target_compilation", 2000, hour]], [], {
        status: "failed",
      }),
      T0,
    );
    expect(sameStageSequence(live, early)).toBe(true);
  });

  test("one stage added to a long pipeline keeps its history", () => {
    const stages = (names: string[]): [string, number, number][] =>
      names.map((name, index) => [name, index * 1000, index * 1000 + 500]);
    const names = Array.from({ length: 12 }, (_, index) => `step_${index}`);
    const before = buildTimeline(ukRun("before", 0, stages(names), [], { status: "completed" }), T0 + hour);
    const after = buildTimeline(
      ukRun("after", 0, stages([...names.slice(0, 6), "new_step", ...names.slice(6)]), [], { status: "completed" }),
      T0 + hour,
    );
    expect(sameStageSequence(after, before)).toBe(true);
  });

  test("expected size-search passes come from past runs and say when the layout differs", () => {
    const history = [
      buildTimeline(oldLayoutRun("old-10", -20 * 24 * hour, 10), T0),
      buildTimeline(oldLayoutRun("old-8", -10 * 24 * hour, 8), T0),
    ];
    const forecast = forecastCompletion(live, [live, ...history], T0 + 6 * hour + min(56))!;
    // Neither old run shares the live run's stage sequence.
    expect(forecast.basis_runs).toEqual([]);
    const solver = forecast.solver!;
    expect(solver.search_passes).toBe(3);
    expect(solver.history_search_passes.sort()).toEqual([10, 8].sort());
    expect(solver.history_same_sequence).toBe(false);
    expect(solver.remaining_passes_p50).toBe(6);
    // Search passes in the live run take 50 min 20 s, idle time included.
    expect(solver.pass_ms).toBe(min(50) + 20_000);
    // The current pass has 70 epochs left at 30 s each.
    expect(solver.remaining_p50_ms).toBe(70 * 30_000 + 6 * (min(50) + 20_000));
    expect(forecast.remaining_p50_ms).toBe(solver.remaining_p50_ms);
    expect(forecast.note).toContain("needed 8–10 size-search passes");
    expect(forecast.note).toContain("earlier stage sequence");
    expect(forecast.note).toContain("about 5–7 more");
    expect(forecast.note).toContain("covers calibration only");
  });

  test("a run that needed more passes than any past run says the count is unknown", () => {
    const history = [buildTimeline(oldLayoutRun("old-2", -20 * 24 * hour, 2), T0)];
    const forecast = forecastCompletion(live, [live, ...history], T0 + 6 * hour + min(56))!;
    expect(forecast.solver!.remaining_passes_p50).toBeNull();
    expect(forecast.remaining_p50_ms).toBe(70 * 30_000);
    expect(forecast.note).toContain("more than any of them");
  });

  test("runs without size search keep the epoch-rate forecast", () => {
    const run = buildTimeline(passedRun("plain", 0), T0 + min(200));
    expect(run.solver_passes).toEqual([]);
    const forecast = forecastCompletion(run, [run], T0 + min(200))!;
    expect(forecast.solver).toBeNull();
  });
});
