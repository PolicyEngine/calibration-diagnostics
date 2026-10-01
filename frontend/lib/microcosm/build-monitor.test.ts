import { describe, expect, test } from "bun:test";

import {
  type BuildRunDocuments,
  type BuildTimeline,
  buildTimeline,
  calibrationRate,
  failureReason,
  forecastCompletion,
  formatStageName,
  gateStatistics,
  isGateStage,
  phaseTotals,
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
