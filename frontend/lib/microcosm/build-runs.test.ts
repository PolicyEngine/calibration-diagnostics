import { beforeEach, describe, expect, jest, spyOn, test } from "bun:test";

import {
  type BuildRunDocuments,
  type RunDelivery,
  buildTimeline,
} from "@/lib/microcosm/build-monitor";
import {
  type HostedRunLoaders,
  collectorRunLists,
  loadBuildRuns,
  loadCollectorTimelines,
  mergeHostedDocuments,
  refreshHostedRun,
} from "@/lib/microcosm/build-runs";
import {
  UK_STAGED_RUN_ID,
  ukStagedCollectorDocuments,
  ukStagedHuggingFaceDocuments,
} from "@/lib/microcosm/test-support/collector-run-fixtures";
import {
  FAKE_COLLECTOR_URL,
  fakeTelemetryCollector,
} from "@/lib/microcosm/test-support/fake-telemetry-collector";
import { secretManager } from "@/lib/server/secret-manager";

const NOW = Date.parse("2026-10-05T12:00:00Z");

// Each test's fake collector answers for itself, not from an earlier test's
// cached run list.
beforeEach(() => collectorRunLists.clear());

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

  test("keeps the list's later Hugging Face end over a collector record that stopped before it", async () => {
    // The list holds the Hugging Face copy, which recorded the run completing
    // at 11:00; the collector's record stops at 10:30, still running.
    const running = documents("run-1", "running");
    const stoppedEarly: BuildRunDocuments = {
      ...running,
      progress: { ...running.progress, updated_at: "2026-10-05T10:30:00Z" },
      events: running.events.map((event) => ({
        ...event,
        timestamp: "2026-10-05T10:30:00Z",
        time: "2026-10-05T10:30:00Z",
      })),
    };
    const current = buildTimeline(documents("run-1", "completed"), NOW);

    const run = await refreshHostedRun(
      current,
      "us",
      "run-1",
      NOW,
      loaders({ loadCollector: async () => stoppedEarly }),
    );

    expect(buildTimeline(stoppedEarly, NOW).state).toBe("running");
    expect(run?.state).toBe("passed");
    expect(run).toBe(current);
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

describe("uploads to Hugging Face for runs the collector records", () => {
  // The collector never learns whether a run's files reached Hugging Face, so
  // the monitor reads the uploads from the run's Hugging Face copy.
  const STAGED_NOW_MS = Date.parse("2026-10-22T17:11:00Z");
  const UPLOADED: RunDelivery = {
    uploads: "uploaded",
    repository: "policyengine/populace-uk-staging",
    reason: null,
    attempts: 39,
    successes: 39,
  };

  function listedRun(huggingFace: BuildRunDocuments[]) {
    return mergeHostedDocuments([ukStagedCollectorDocuments()], huggingFace, STAGED_NOW_MS)
      .map((documents) => buildTimeline(documents, STAGED_NOW_MS))
      .find((timeline) => timeline.run_id === UK_STAGED_RUN_ID)!;
  }

  test("the list shows the uploads the Hugging Face copy records", () => {
    const run = listedRun([ukStagedHuggingFaceDocuments()]);

    // The collector's record still sets the state and the end.
    expect(run.state).toBe("passed");
    expect(run.ended_ms).toBe(Date.parse("2026-10-21T20:36:30Z"));
    expect(run.delivery).toEqual(UPLOADED);
  });

  test("uploads stay unknown when the run has no Hugging Face copy", () => {
    const run = listedRun([]);

    expect(run.delivery?.uploads).toBe("unknown");
  });

  test("uploads stay unknown when the Hugging Face copy records none", () => {
    const copy = ukStagedHuggingFaceDocuments();
    const { delivery: _progressDelivery, ...progress } = copy.progress!;
    const run = listedRun([{ ...copy, progress, run_manifest: null }]);

    expect(run.delivery?.uploads).toBe("unknown");
  });

  test("refreshing the selected run from the collector keeps the listed uploads", async () => {
    const listed = listedRun([ukStagedHuggingFaceDocuments()]);
    let historyCalls = 0;

    const run = await refreshHostedRun(
      listed,
      "uk",
      UK_STAGED_RUN_ID,
      STAGED_NOW_MS,
      loaders({
        loadCollector: async () => ukStagedCollectorDocuments(),
        loadHistory: async () => {
          historyCalls += 1;
          return ukStagedHuggingFaceDocuments();
        },
      }),
    );

    expect(run?.state).toBe("passed");
    expect(run?.delivery).toEqual(UPLOADED);
    expect(historyCalls).toBe(0);
  });
});

describe("one collector run list for every Staging route", () => {
  test("the Build progress list and both Candidate routes share one list request", async () => {
    // The be country has no staging repository, so Build progress reads only
    // the collector.
    const collector = fakeTelemetryCollector({ countryCode: "BE", runCount: 3 });
    const runningRunId = collector.runs[0].run_id;

    await withCollector(collector.fetch, async () => {
      await loadBuildRuns("staging", "be");
      // The Candidate tab's run list and its selected run.
      await loadCollectorTimelines("be", [runningRunId], NOW);
      await loadCollectorTimelines("be", [runningRunId], NOW);
    });

    expect(collector.listRequests).toHaveLength(1);
    // A running run's own record is still read for every request.
    expect(
      collector.documentRequests.filter((runId) => runId === runningRunId),
    ).toHaveLength(3);
  });

  test("the list is read again once it is 15 seconds old", async () => {
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 3 });
    const runningRunId = collector.runs[0].run_id;
    const listRequestsAt: number[] = [];

    jest.useFakeTimers();
    try {
      await withCollector(collector.fetch, async () => {
        await loadCollectorTimelines("am", [runningRunId], NOW);
        listRequestsAt.push(collector.listRequests.length);
        jest.advanceTimersByTime(14_000);
        await loadCollectorTimelines("am", [runningRunId], NOW);
        listRequestsAt.push(collector.listRequests.length);
        jest.advanceTimersByTime(2_000);
        await loadCollectorTimelines("am", [runningRunId], NOW);
        listRequestsAt.push(collector.listRequests.length);
      });
    } finally {
      jest.useRealTimers();
    }

    expect(listRequestsAt).toEqual([1, 1, 2]);
  });

  test("a failed list request is not reused", async () => {
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 3 });
    const runningRunId = collector.runs[0].run_id;
    let listRequestCount = 0;
    const failingOnce = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/v1/runs" && listRequestCount++ === 0) {
        return Response.json({ detail: "Unavailable." }, { status: 503 });
      }
      return collector.fetch(input);
    }) as typeof fetch;

    const [failed, answered] = await withCollector(failingOnce, async () => [
      await loadCollectorTimelines("am", [runningRunId], NOW),
      await loadCollectorTimelines("am", [runningRunId], NOW),
    ]);

    expect(failed.note).toContain("503");
    expect(answered.note).toBeNull();
    expect(answered.timelines.get(runningRunId)?.state).toBe("running");
  });

  test("the Candidate tab waits at most 5 seconds for the list, and a late answer serves the next poll", async () => {
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 3 });
    const runningRunId = collector.runs[0].run_id;
    let answerList!: () => void;
    const listAnswer = new Promise<void>((resolve) => {
      answerList = resolve;
    });
    const slowList = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/v1/runs") await listAnswer;
      return collector.fetch(input);
    }) as typeof fetch;

    jest.useFakeTimers();
    let firstPoll: Awaited<ReturnType<typeof loadCollectorTimelines>>;
    let nextPoll: Awaited<ReturnType<typeof loadCollectorTimelines>>;
    try {
      [firstPoll, nextPoll] = await withCollector(slowList, async () => {
        const pending = loadCollectorTimelines("am", [runningRunId], NOW);
        jest.advanceTimersByTime(5_000);
        // The collector answers only after the wait is over.
        answerList();
        return [await pending, await loadCollectorTimelines("am", [runningRunId], NOW)];
      });
    } finally {
      jest.useRealTimers();
    }

    expect(firstPoll.timelines.size).toBe(0);
    expect(firstPoll.note).toContain("did not answer within 5 seconds");
    expect(firstPoll.note).toContain("Hugging Face");
    expect(nextPoll.note).toBeNull();
    expect(nextPoll.timelines.get(runningRunId)?.state).toBe("running");
    expect(collector.listRequests).toHaveLength(1);
  });

  test("a late answer serves the next 30-second poll while the collector stays slow", async () => {
    // The Candidate tab polls every 30 seconds. A list that answers 6 seconds
    // after each request is more than 15 seconds old at the next poll, whose
    // own request is again slower than the 5-second wait.
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 3 });
    const runningRunId = collector.runs[0].run_id;
    const unansweredListRequests: Array<() => void> = [];
    const slowList = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/v1/runs") {
        await new Promise<void>((resolve) => unansweredListRequests.push(resolve));
      }
      return collector.fetch(input);
    }) as typeof fetch;

    jest.useFakeTimers();
    let firstPoll: Awaited<ReturnType<typeof loadCollectorTimelines>>;
    let nextPoll: Awaited<ReturnType<typeof loadCollectorTimelines>>;
    try {
      [firstPoll, nextPoll] = await withCollector(slowList, async () => {
        const firstPending = loadCollectorTimelines("am", [runningRunId], NOW);
        jest.advanceTimersByTime(5_000);
        const first = await firstPending;
        // The first request answers 6 seconds after it was made.
        jest.advanceTimersByTime(1_000);
        unansweredListRequests.shift()?.();
        await collectorRunLists.recent("am");
        // The next poll, 30 seconds after the first.
        jest.advanceTimersByTime(24_000);
        const nextPending = loadCollectorTimelines("am", [runningRunId], NOW);
        jest.advanceTimersByTime(5_000);
        const next = await nextPending;
        for (const answer of unansweredListRequests.splice(0)) answer();
        return [first, next];
      });
    } finally {
      jest.useRealTimers();
    }

    expect(firstPoll.note).toContain("did not answer within 5 seconds");
    expect(nextPoll.note).toBeNull();
    expect(nextPoll.timelines.get(runningRunId)?.state).toBe("running");
  });

  test("an answer a minute old no longer stands in for a slow list", async () => {
    const collector = fakeTelemetryCollector({ countryCode: "AM", runCount: 3 });
    const runningRunId = collector.runs[0].run_id;
    let listRequestCount = 0;
    const unansweredListRequests: Array<() => void> = [];
    // The first list request answers at once; later ones are slow.
    const slowAfterFirst = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/v1/runs" && listRequestCount++ > 0) {
        await new Promise<void>((resolve) => unansweredListRequests.push(resolve));
      }
      return collector.fetch(input);
    }) as typeof fetch;

    jest.useFakeTimers();
    let latePoll: Awaited<ReturnType<typeof loadCollectorTimelines>>;
    try {
      latePoll = await withCollector(slowAfterFirst, async () => {
        await loadCollectorTimelines("am", [runningRunId], NOW);
        jest.advanceTimersByTime(60_000);
        const latePending = loadCollectorTimelines("am", [runningRunId], NOW);
        jest.advanceTimersByTime(5_000);
        const late = await latePending;
        for (const answer of unansweredListRequests.splice(0)) answer();
        return late;
      });
    } finally {
      jest.useRealTimers();
    }

    expect(latePoll.timelines.size).toBe(0);
    expect(latePoll.note).toContain("did not answer within 5 seconds");
  });
});
