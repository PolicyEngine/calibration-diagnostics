import { describe, expect, test } from "bun:test";

import {
  type BuildRunDocuments,
  buildTimeline,
} from "@/lib/microcosm/build-monitor";
import {
  type HostedRunLoaders,
  refreshHostedRun,
} from "@/lib/microcosm/build-runs";

const NOW = Date.parse("2026-10-05T12:00:00Z");

function documents(
  runId: string,
  status: "running" | "completed",
): BuildRunDocuments {
  const finished = status === "completed";
  return {
    run_id: runId,
    source: "staging",
    country: "us",
    progress: {
      schema_version: 2,
      run_id: runId,
      country_code: "US",
      pipeline: { id: "us-fiscal-refresh", version: "collector-v1" },
      started_at: "2026-10-05T10:00:00Z",
      updated_at: finished ? "2026-10-05T11:00:00Z" : "2026-10-05T11:59:00Z",
      status,
      current_stage: finished ? "complete" : "target_compilation",
    },
    run_manifest: null,
    calibration_progress: null,
    events: [
      {
        schema_version: 2,
        sequence: 1,
        run_id: runId,
        event_type: "stage",
        stage_id: finished ? "complete" : "target_compilation",
        stage: finished ? "complete" : "target_compilation",
        status: finished ? "completed" : "started",
        timestamp: finished ? "2026-10-05T11:00:00Z" : "2026-10-05T11:59:00Z",
        time: finished ? "2026-10-05T11:00:00Z" : "2026-10-05T11:59:00Z",
        details: {},
      },
    ],
  };
}

function loaders(overrides: Partial<HostedRunLoaders> = {}): HostedRunLoaders {
  return {
    collectorConfigured: () => true,
    hasStagingHistory: () => true,
    loadCollector: async () => documents("run-1", "running"),
    loadHistory: async () => documents("run-1", "completed"),
    ...overrides,
  };
}

describe("refreshHostedRun", () => {
  test("uses a successful collector response without reading staged history", async () => {
    let historyCalls = 0;
    const run = await refreshHostedRun(
      null,
      "us",
      "run-1",
      NOW,
      loaders({
        loadHistory: async () => {
          historyCalls += 1;
          return documents("run-1", "completed");
        },
      }),
    );

    expect(run?.state).toBe("running");
    expect(historyCalls).toBe(0);
  });

  test("falls back to staged history when the collector has no run", async () => {
    const run = await refreshHostedRun(
      null,
      "us",
      "run-1",
      NOW,
      loaders({
        loadCollector: async () => {
          throw new Error("collector returned 404");
        },
      }),
    );

    expect(run?.state).toBe("passed");
  });

  test("falls back to staged history when the collector is unavailable", async () => {
    const run = await refreshHostedRun(
      buildTimeline(documents("run-1", "running"), NOW),
      "us",
      "run-1",
      NOW,
      loaders({
        loadCollector: async () => {
          throw new Error("collector unavailable");
        },
      }),
    );

    expect(run?.state).toBe("passed");
  });

  test("returns the current run when both refresh sources fail", async () => {
    const current = buildTimeline(documents("run-1", "running"), NOW);
    const run = await refreshHostedRun(
      current,
      "us",
      "run-1",
      NOW,
      loaders({
        loadCollector: async () => {
          throw new Error("collector unavailable");
        },
        loadHistory: async () => {
          throw new Error("history unavailable");
        },
      }),
    );

    expect(run).toBe(current);
  });

  test("does not refresh a completed run", async () => {
    const current = buildTimeline(documents("run-1", "completed"), NOW);
    let calls = 0;
    const run = await refreshHostedRun(
      current,
      "us",
      "run-1",
      NOW,
      loaders({
        loadCollector: async () => {
          calls += 1;
          return documents("run-1", "running");
        },
        loadHistory: async () => {
          calls += 1;
          return documents("run-1", "running");
        },
      }),
    );

    expect(run).toBe(current);
    expect(calls).toBe(0);
  });

  test("surfaces collector failure when no staged history exists", async () => {
    await expect(
      refreshHostedRun(
        null,
        "be",
        "run-1",
        NOW,
        loaders({
          hasStagingHistory: () => false,
          loadCollector: async () => {
            throw new Error("collector unavailable");
          },
        }),
      ),
    ).rejects.toThrow("collector unavailable");
  });
});
