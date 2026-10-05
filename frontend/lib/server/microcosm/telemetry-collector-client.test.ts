import { afterEach, expect, test } from "bun:test";

import {
  collectorConfigured,
  loadCollectorRun,
  loadCollectorRuns,
} from "@/lib/server/microcosm/telemetry-collector-client";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
const originalToken = process.env.MICROCOSM_TELEMETRY_COLLECTOR_READ_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl == null) delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
  else process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = originalUrl;
  if (originalToken == null) {
    delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_READ_TOKEN;
  } else {
    process.env.MICROCOSM_TELEMETRY_COLLECTOR_READ_TOKEN = originalToken;
  }
});

function configure() {
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = "https://telemetry.example";
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_READ_TOKEN = "secret-read-token";
}

test("collector configuration requires both server values", () => {
  delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
  delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_READ_TOKEN;
  expect(collectorConfigured()).toBe(false);
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = "https://telemetry.example";
  expect(collectorConfigured()).toBe(false);
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_READ_TOKEN = "token";
  expect(collectorConfigured()).toBe(true);
});

test("loads every collector list page and authenticates server-side", async () => {
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
        runs: [{ run_id: "new", country_code: "US" }],
        next_before: "2026-10-01T00:00:00Z",
      });
    }
    return Response.json({
      runs: [{ run_id: "old", country_code: "US" }],
      next_before: null,
    });
  }) as typeof fetch;

  const runs = await loadCollectorRuns("us");

  expect(runs.map((run) => run.run_id)).toEqual(["new", "old"]);
  expect(calls).toHaveLength(2);
  expect(calls[0].searchParams.get("country")).toBe("US");
  expect(calls[1].searchParams.get("before")).toBe("2026-10-01T00:00:00Z");
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
