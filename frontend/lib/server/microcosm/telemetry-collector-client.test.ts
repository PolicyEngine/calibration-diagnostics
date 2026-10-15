import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { secretManager } from "@/lib/server/secret-manager";

import {
  collectorConfigured,
  loadCollectorRun,
  loadCollectorRuns,
} from "@/lib/server/microcosm/telemetry-collector-client";
import {
  entireCollectorHistory,
  FAKE_COLLECTOR_URL,
  fakeTelemetryCollector,
  type FakeTelemetryCollector,
} from "@/lib/microcosm/test-support/fake-telemetry-collector";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
const originalSecretVersion =
  process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION;
const secretVersion =
  "projects/test-project/secrets/collector-read/versions/latest";
const readSecret = spyOn(secretManager, "readVersion");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl == null) delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
  else process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = originalUrl;
  readSecret.mockReset();
  if (originalSecretVersion == null) {
    delete process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION;
  } else {
    process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION = originalSecretVersion;
  }
});

const DASHBOARD_RUN_LIMIT = 60;

function configure() {
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = FAKE_COLLECTOR_URL;
  process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION = secretVersion;
  readSecret.mockResolvedValue("secret-read-token");
}

function serveUsCollector(
  runCount: number,
  largestPage?: number,
): FakeTelemetryCollector {
  configure();
  const collector = fakeTelemetryCollector({
    countryCode: "US",
    runCount,
    largestPage,
  });
  globalThis.fetch = collector.fetch;
  return collector;
}

function requestedLimits(collector: FakeTelemetryCollector): string[] {
  return collector.listRequests.map(
    (request) => request.searchParams.get("limit") ?? "",
  );
}

function runIds(runs: { run_id: string }[]): string[] {
  return runs.map((run) => run.run_id);
}

function serveListPages(pages: Response[]): URL[] {
  configure();
  const requests: URL[] = [];
  globalThis.fetch = (async (input) => {
    requests.push(new URL(String(input)));
    const page = pages.shift();
    if (!page) throw new Error("The collector was asked for an extra page.");
    return page;
  }) as typeof fetch;
  return requests;
}

function runSummary(runId: string) {
  return {
    run_id: runId,
    country_code: "US",
    status: "completed",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

test("collector configuration requires an address and secret resource", () => {
  delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
  delete process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION;
  expect(collectorConfigured()).toBe(false);
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = "https://telemetry.example";
  expect(collectorConfigured()).toBe(false);
  process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION = secretVersion;
  expect(collectorConfigured()).toBe(true);
  expect(readSecret).not.toHaveBeenCalled();
});

test("authenticates every collector list request server-side", async () => {
  configure();
  const calls: URL[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    expect(new Headers(init?.headers).get("X-Telemetry-Read-Token")).toBe(
      "secret-read-token",
    );
    if (!url.searchParams.has("before")) {
      return Response.json({
        runs: [
          {
            run_id: "new",
            country_code: "US",
            status: "running",
            updated_at: "2026-10-02T00:00:00Z",
          },
        ],
        next_before: "2026-10-01T00:00:00Z",
      });
    }
    return Response.json({
      runs: [
        {
          run_id: "old",
          country_code: "US",
          status: "completed",
          updated_at: "2026-10-01T00:00:00Z",
        },
      ],
      next_before: null,
    });
  }) as typeof fetch;

  const runs = await loadCollectorRuns("us", DASHBOARD_RUN_LIMIT);

  expect(runs.map((run) => run.run_id)).toEqual(["new", "old"]);
  expect(calls).toHaveLength(2);
  expect(calls[0].searchParams.get("country")).toBe("US");
  expect(calls[1].searchParams.get("before")).toBe("2026-10-01T00:00:00Z");
  expect(readSecret).toHaveBeenCalledWith(secretVersion);
});

test("loads run documents without exposing the read token", async () => {
  configure();
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe("https://telemetry.example/v1/runs/run-1");
    expect(new Headers(init?.headers).get("X-Telemetry-Read-Token")).toBe(
      "secret-read-token",
    );
    return Response.json({
      run_id: "run-1",
      country_code: "US",
      progress: { schema_version: 2, status: "running" },
      run_manifest: null,
      calibration_progress: null,
      events: [],
    });
  }) as typeof fetch;

  const run = await loadCollectorRun("run-1", "us");

  expect(run).toMatchObject({
    run_id: "run-1",
    source: "staging",
    country: "us",
    progress: { schema_version: 2, status: "running" },
  });
  expect(JSON.stringify(run)).not.toContain("secret-read-token");
});

test("does not call the collector when Secret Manager access fails", async () => {
  configure();
  readSecret.mockRejectedValue(new Error("Secret Manager unavailable"));
  const fetchSpy = spyOn(globalThis, "fetch");
  await expect(loadCollectorRuns("us", DASHBOARD_RUN_LIMIT)).rejects.toThrow(
    "Secret Manager unavailable",
  );
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

describe("bounded collector run listing", () => {
  test("requests only the most recent runs in one bounded collector request", async () => {
    const collector = serveUsCollector(500);

    const runs = await loadCollectorRuns("us", DASHBOARD_RUN_LIMIT);

    expect(runs).toHaveLength(DASHBOARD_RUN_LIMIT);
    expect(collector.listRequests).toHaveLength(1);
    expect(requestedLimits(collector)).toEqual(["60"]);
    expect(collector.listRequests[0].searchParams.has("before")).toBe(false);
    expect(collector.listRequests[0].searchParams.get("country")).toBe("US");
  });

  test("returns the same most recent runs as reading the entire history", async () => {
    const collector = serveUsCollector(250);
    const history = await entireCollectorHistory(collector, "US");

    const runs = await loadCollectorRuns("us", DASHBOARD_RUN_LIMIT);

    expect(history).toHaveLength(250);
    expect(runs).toEqual(history.slice(0, DASHBOARD_RUN_LIMIT));
  });

  test("returns every run when the collector holds fewer runs than the limit", async () => {
    const collector = serveUsCollector(12);

    const runs = await loadCollectorRuns("us", DASHBOARD_RUN_LIMIT);

    expect(runIds(runs)).toEqual(runIds(collector.runs));
    expect(requestedLimits(collector)).toEqual(["60"]);
  });

  test("does not follow the cursor when exactly the limit is returned", async () => {
    const collector = serveUsCollector(60);

    const runs = await loadCollectorRuns("us", DASHBOARD_RUN_LIMIT);

    expect(runIds(runs)).toEqual(runIds(collector.runs));
    expect(requestedLimits(collector)).toEqual(["60"]);
    // A full page always carries a cursor, even when no older run exists.
    expect(collector.servedCursors[0]).not.toBeNull();
    expect(collector.listRequests).toHaveLength(1);
  });

  test("leaves out runs older than the limit", async () => {
    const collector = serveUsCollector(61);

    const runs = await loadCollectorRuns("us", DASHBOARD_RUN_LIMIT);

    expect(runIds(runs)).toEqual(runIds(collector.runs.slice(0, 60)));
    expect(runIds(runs)).not.toContain(collector.runs[60].run_id);
    expect(collector.listRequests).toHaveLength(1);
  });

  test("follows cursors across short pages for only the remaining runs", async () => {
    const collector = serveUsCollector(500, 25);

    const runs = await loadCollectorRuns("us", DASHBOARD_RUN_LIMIT);

    expect(runIds(runs)).toEqual(runIds(collector.runs.slice(0, 60)));
    expect(requestedLimits(collector)).toEqual(["60", "35", "10"]);
    expect(collector.listRequests[0].searchParams.has("before")).toBe(false);
    expect(collector.listRequests[1].searchParams.get("before")).toBeTruthy();
    expect(collector.listRequests[2].searchParams.get("before")).not.toBe(
      collector.listRequests[1].searchParams.get("before"),
    );
  });

  test("pages past the collector's 200-run maximum for larger limits", async () => {
    const collector = serveUsCollector(1000);

    const runs = await loadCollectorRuns("us", 450);

    expect(runIds(runs)).toEqual(runIds(collector.runs.slice(0, 450)));
    expect(requestedLimits(collector)).toEqual(["200", "200", "50"]);
  });

  test("stops at the end of history inside a page boundary", async () => {
    const collector = serveUsCollector(230);

    const runs = await loadCollectorRuns("us", 450);

    expect(runIds(runs)).toEqual(runIds(collector.runs));
    expect(requestedLimits(collector)).toEqual(["200", "200"]);
  });
});

describe("collector run listing errors", () => {
  test("rejects a failed collector list response with its status", async () => {
    serveListPages([new Response("unavailable", { status: 503 })]);

    await expect(loadCollectorRuns("us", DASHBOARD_RUN_LIMIT)).rejects.toThrow(
      "Telemetry collector request failed (503).",
    );
  });

  test("rejects a run page without a runs array", async () => {
    serveListPages([Response.json({ next_before: null })]);

    await expect(loadCollectorRuns("us", DASHBOARD_RUN_LIMIT)).rejects.toThrow(
      "Telemetry collector run page must contain a runs array.",
    );
  });

  test("rejects a run summary without a run id", async () => {
    serveListPages([
      Response.json({
        runs: [{ ...runSummary("unused"), run_id: "" }],
        next_before: null,
      }),
    ]);

    await expect(loadCollectorRuns("us", DASHBOARD_RUN_LIMIT)).rejects.toThrow(
      "Telemetry collector run_id must be a non-empty string.",
    );
  });

  test("rejects an invalid pagination cursor", async () => {
    serveListPages([Response.json({ runs: [], next_before: 7 })]);

    await expect(loadCollectorRuns("us", DASHBOARD_RUN_LIMIT)).rejects.toThrow(
      "Telemetry collector pagination cursor is invalid.",
    );
  });

  test("rejects a repeated pagination cursor", async () => {
    serveListPages([
      Response.json({ runs: [runSummary("first")], next_before: "same" }),
      Response.json({ runs: [runSummary("second")], next_before: "same" }),
    ]);

    await expect(loadCollectorRuns("us", DASHBOARD_RUN_LIMIT)).rejects.toThrow(
      "Telemetry collector pagination repeated a cursor.",
    );
  });

  test("rejects instead of returning a partial list when a later page fails", async () => {
    const requests = serveListPages([
      Response.json({ runs: [runSummary("first")], next_before: "next" }),
      new Response("error", { status: 500 }),
    ]);

    await expect(loadCollectorRuns("us", DASHBOARD_RUN_LIMIT)).rejects.toThrow(
      "Telemetry collector request failed (500).",
    );
    expect(requests).toHaveLength(2);
  });
});
