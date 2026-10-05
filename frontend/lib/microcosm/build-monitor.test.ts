import { describe, expect, test } from "bun:test";

import {
  HEARTBEAT_STALE_MS,
  type BuildRunDocuments,
  type BuildTimeline,
  buildTimeline,
  calibrationRate,
  failureClassStatistics,
  failureReason,
  forecastCompletion,
  formatStageName,
  gateStatistics,
  isGateStage,
  phaseTotals,
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
      failure_class: null,
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
    expect(forecast.note).toContain("No finished comparable runs");
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

  test("failures are counted by the class the run recorded", () => {
    const failed = buildTimeline(
      v1Run("gate", [["release_gates", 0]], { end: ["failed", min(200), "Release gates failed: x"] }),
      T0 + min(300),
    );
    failed.failure = { ...failed.failure!, failure_class: "gate_refused" };
    // Went silent 30 minutes in: a kill, not an abort.
    const stalled = buildTimeline(
      v1Run("quiet", [
        ["load_base_frame", 0],
        ["target_compilation", min(30)],
      ]),
      T0 + min(30) + STALL_MS + min(1),
    );
    const stats = failureClassStatistics([failed, stalled, buildTimeline(passedRun("ok", 0), T0)]);
    expect(stats.map((stat) => [stat.failure_class, stat.runs])).toEqual([
      ["gate_refused", 1],
      ["stopped_without_final_event", 1],
    ]);
    expect(stats[0].median_compute_lost_ms).toBe(min(200));
    expect(stats[0].inferred).toBe(0);
    expect(stats[1].stages).toEqual([{ stage: "target_compilation", count: 1 }]);
  });

  test("old failures without a class get an inferred one", () => {
    const gate = buildTimeline(
      v1Run("old-gate", [["release_gates", 0]], { end: ["failed", min(5), "Release gates failed: QRF tail"] }),
      T0 + min(10),
    );
    const crash = buildTimeline(
      v1Run("old-crash", [["export_dataset", 0]], { end: ["failed", min(5), "KeyError: 'weights'"] }),
      T0 + min(10),
    );
    const early = buildTimeline(v1Run("aborted", [["target_registry", 0]]), T0 + STALL_MS + min(1));
    const stats = failureClassStatistics([gate, crash, early]);
    const byClass = Object.fromEntries(stats.map((stat) => [stat.failure_class, stat]));
    expect(byClass.gate_refused.inferred).toBe(1);
    expect(byClass.gate_refused.reasons).toEqual([{ reason: "Release gates failed", count: 1 }]);
    expect(byClass.error.stages).toEqual([{ stage: "export_dataset", count: 1 }]);
    expect(byClass.abandoned_early.runs).toBe(1);
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
