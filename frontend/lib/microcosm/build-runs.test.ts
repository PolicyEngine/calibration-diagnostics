import { describe, expect, spyOn, test } from "bun:test";

import {
  type BuildRunDocuments,
  buildTimeline,
} from "@/lib/microcosm/build-monitor";
import {
  type HostedRunLoaders,
  loadBuildRuns,
  loadCollectorTimelines,
  refreshHostedRun,
} from "@/lib/microcosm/build-runs";
import {
  FAKE_COLLECTOR_URL,
  fakeTelemetryCollector,
} from "@/lib/microcosm/test-support/fake-telemetry-collector";
import { secretManager } from "@/lib/server/secret-manager";

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

  test("refreshes a completed run because a later producer can reopen it", async () => {
    const current = buildTimeline(documents("run-1", "completed"), NOW);
    let collectorCalls = 0;
    let historyCalls = 0;
    const run = await refreshHostedRun(
      current,
      "us",
      "run-1",
      NOW,
      loaders({
        loadCollector: async () => {
          collectorCalls += 1;
          return documents("run-1", "running");
        },
        loadHistory: async () => {
          historyCalls += 1;
          return documents("run-1", "running");
        },
      }),
    );

    expect(run?.state).toBe("running");
    expect(collectorCalls).toBe(1);
    expect(historyCalls).toBe(0);
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

describe("loadBuildRuns from the collector", () => {
  test("the build monitor reads only its 60 most recent collector runs", async () => {
    // The zz fixture country has no staging repository, so the collector is
    // the only hosted source and no Hugging Face request is made.
    const collector = fakeTelemetryCollector({
      countryCode: "ZZ",
      runCount: 250,
    });
    const originalFetch = globalThis.fetch;
    const originalEnvironment = {
      MICROCOSM_TELEMETRY_COLLECTOR_URL:
        process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL,
      MICROCOSM_TELEMETRY_READ_SECRET_VERSION:
        process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION,
    };
    const readSecret = spyOn(secretManager, "readVersion").mockResolvedValue(
      "secret-read-token",
    );
    process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = FAKE_COLLECTOR_URL;
    process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION =
      "projects/test-project/secrets/collector-read/versions/latest";
    globalThis.fetch = collector.fetch;
    try {
      const response = await loadBuildRuns("staging", "zz");

      const newestRunIds = collector.runs
        .slice(0, 60)
        .map((run) => run.run_id);
      expect(response.available).toBe(true);
      expect(response.problems).toEqual([]);
      expect(collector.listRequests).toHaveLength(1);
      expect(collector.listRequests[0].searchParams.get("limit")).toBe("60");
      expect(collector.documentRequests.toSorted()).toEqual(
        newestRunIds.toSorted(),
      );
      expect(response.runs.map((run) => run.run_id)).toEqual(newestRunIds);
    } finally {
      globalThis.fetch = originalFetch;
      readSecret.mockRestore();
      for (const [name, value] of Object.entries(originalEnvironment)) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

const READ_SECRET_VERSION =
  "projects/test-project/secrets/collector-read/versions/latest";

// Runs `body` with the collector configured to answer through `collectorFetch`,
// or with the collector not configured when it is null.
async function withCollector<T>(
  collectorFetch: typeof fetch | null,
  body: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    MICROCOSM_TELEMETRY_COLLECTOR_URL:
      process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL,
    MICROCOSM_TELEMETRY_READ_SECRET_VERSION:
      process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION,
  };
  const readSecret = spyOn(secretManager, "readVersion").mockResolvedValue(
    "secret-read-token",
  );
  if (collectorFetch) {
    process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = FAKE_COLLECTOR_URL;
    process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION = READ_SECRET_VERSION;
    globalThis.fetch = collectorFetch;
  } else {
    delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
    delete process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION;
    globalThis.fetch = (async () => {
      throw new Error("An unconfigured collector must not be requested.");
    }) as unknown as typeof fetch;
  }
  try {
    return await body();
  } finally {
    globalThis.fetch = originalFetch;
    readSecret.mockRestore();
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("loadCollectorTimelines for the Candidate tab", () => {
  test("reads the collector's records only for the requested runs it knows", async () => {
    // The am fixture country has a staging repository, like a country whose
    // Candidate tab lists Hugging Face runs.
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 80 });
    const newest = collector.runs[0].run_id;
    const finished = collector.runs[5].run_id;
    const olderThanTheListedRuns = collector.runs[70].run_id;

    const loaded = await withCollector(collector.fetch, () =>
      loadCollectorTimelines(
        "am",
        [newest, finished, olderThanTheListedRuns, "hugging-face-only-run"],
        NOW,
      ),
    );

    expect(loaded.note).toBeNull();
    expect(collector.listRequests).toHaveLength(1);
    expect(collector.listRequests[0].searchParams.get("country")).toBe("AM");
    expect(collector.listRequests[0].searchParams.get("limit")).toBe("60");
    expect(collector.documentRequests.toSorted()).toEqual(
      [newest, finished].toSorted(),
    );
    expect([...loaded.timelines.keys()].toSorted()).toEqual(
      [newest, finished].toSorted(),
    );
    expect(loaded.timelines.get(newest)?.state).toBe("running");
    expect(loaded.timelines.get(finished)?.state).toBe("passed");
  });

  test("asks the collector nothing when no run is requested", async () => {
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 3 });

    const loaded = await withCollector(collector.fetch, () =>
      loadCollectorTimelines("am", [], NOW),
    );

    expect(loaded).toEqual({ timelines: new Map(), note: null });
    expect(collector.listRequests).toHaveLength(0);
  });

  test("an unconfigured collector leaves every run on Hugging Face, with a note", async () => {
    const loaded = await withCollector(null, () =>
      loadCollectorTimelines("am", ["run-0001"], NOW),
    );

    expect(loaded.timelines.size).toBe(0);
    expect(loaded.note).toContain("not configured");
  });

  test("a failed collector request leaves every run on Hugging Face, with a note", async () => {
    const unavailable = (async () =>
      Response.json({ detail: "Unavailable." }, { status: 503 })) as unknown as typeof fetch;

    const loaded = await withCollector(unavailable, () =>
      loadCollectorTimelines("am", ["run-0001"], NOW),
    );

    expect(loaded.timelines.size).toBe(0);
    expect(loaded.note).toContain("could not be read");
    expect(loaded.note).toContain("503");
  });

  test("a run whose collector record fails keeps its Hugging Face state, with a note", async () => {
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 4 });
    const unreadable = collector.runs[1].run_id;
    const readable = collector.runs[2].run_id;
    const failingOneRecord = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith(`/v1/runs/${unreadable}`)) {
        return Response.json({ detail: "Internal error." }, { status: 500 });
      }
      return collector.fetch(input);
    }) as typeof fetch;

    const loaded = await withCollector(failingOneRecord, () =>
      loadCollectorTimelines("am", [unreadable, readable], NOW),
    );

    expect([...loaded.timelines.keys()]).toEqual([readable]);
    expect(loaded.note).toContain(unreadable);
    expect(loaded.note).toContain("500");
  });
});
