import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  recordedBody,
  withInstants,
} from "@/lib/microcosm/test-support/collector-read-api/recorded-answers";
import { secretManager } from "@/lib/server/secret-manager";
import {
  CollectorRequestError,
  collectorConfigured,
  loadCollectorRun,
  loadCollectorRuns,
} from "@/lib/server/microcosm/telemetry-collector-client";

// With MICROCOSM_TELEMETRY_VERCEL_OIDC=1 the dashboard reads read API v2
// through the collector's typed client, authenticated with the deployment's
// Vercel OIDC token, and never reads the read credential from Secret Manager.

const COLLECTOR_URL = "https://telemetry.example";
const VERCEL_OIDC_TOKEN = "vercel-oidc-token-for-tests";
const SETTING = "MICROCOSM_TELEMETRY_VERCEL_OIDC";
const SETTINGS = [
  "MICROCOSM_TELEMETRY_COLLECTOR_URL",
  "MICROCOSM_TELEMETRY_READ_SECRET_VERSION",
  SETTING,
] as const;

type JsonObject = Record<string, unknown>;

const originalFetch = globalThis.fetch;
const originalSettings = Object.fromEntries(
  SETTINGS.map((name) => [name, process.env[name]]),
);
const readSecret = spyOn(secretManager, "readVersion");
const restoreAfterEach: { mockRestore(): void }[] = [];

beforeEach(() => {
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = COLLECTOR_URL;
  delete process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION;
  process.env[SETTING] = "1";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of SETTINGS) {
    const original = originalSettings[name];
    if (original == null) delete process.env[name];
    else process.env[name] = original;
  }
  readSecret.mockReset();
  while (restoreAfterEach.length) restoreAfterEach.pop()?.mockRestore();
});

// Replaces the deployment's Vercel OIDC token. Imported here rather than at
// the top, so that without the module each test fails on this assertion
// instead of the file failing to load.
async function serveVercelOidcToken(token: string | (() => string)) {
  const loaded = await import("@/lib/server/vercel-oidc").catch(() => null);
  expect(loaded).not.toBeNull();
  const tokenSpy = spyOn(
    (loaded as { vercelOidc: { token: () => Promise<string> } }).vercelOidc,
    "token",
  ).mockImplementation(async () =>
    typeof token === "function" ? token() : token,
  );
  restoreAfterEach.push(tokenSpy);
  return tokenSpy;
}

interface SentRequest {
  url: URL;
  headers: Headers;
}

// A collector that answers each request with the next answer given, and
// records what was sent.
function serveAnswers(answers: Response[]): SentRequest[] {
  const sent: SentRequest[] = [];
  globalThis.fetch = (async (input, init) => {
    sent.push({
      url: new URL(String(input)),
      headers: new Headers(init?.headers),
    });
    const next = answers.shift();
    if (!next) throw new Error("The collector was asked for an extra answer.");
    return next;
  }) as typeof fetch;
  return sent;
}

function runSummary(runId: string, countryCode = "US"): JsonObject {
  const listed = (recordedBody("v2", "list-runs").runs as JsonObject[])[0];
  return { ...listed, run_id: runId, country_code: countryCode };
}

describe("the setting", () => {
  test("needs only the collector address when it is on", () => {
    expect(collectorConfigured()).toBe(true);
    delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;
    expect(collectorConfigured()).toBe(false);
  });

  test("leaves the read credential setting required when it is off", () => {
    for (const off of ["0", ""]) {
      process.env[SETTING] = off;
      expect(collectorConfigured()).toBe(false);
    }
    delete process.env[SETTING];
    expect(collectorConfigured()).toBe(false);
  });

  test("refuses a value other than 1 or 0", () => {
    process.env[SETTING] = "yes";
    expect(() => collectorConfigured()).toThrow(
      "MICROCOSM_TELEMETRY_VERCEL_OIDC must be 1 or 0.",
    );
  });

  test("off, the dashboard reads version 1 with the read credential, not the Vercel OIDC token", async () => {
    const tokenSpy = await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    process.env[SETTING] = "0";
    process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION =
      "projects/test-project/secrets/collector-read/versions/latest";
    readSecret.mockResolvedValue("secret-read-token");
    const sent = serveAnswers([
      Response.json({ runs: [runSummary("run-1")], next_before: null }),
    ]);

    await loadCollectorRuns("us", 60);

    expect(sent[0]?.url.pathname).toBe("/v1/runs");
    expect(sent[0]?.headers.get("X-Telemetry-Read-Token")).toBe(
      "secret-read-token",
    );
    expect(sent[0]?.headers.has("Authorization")).toBe(false);
    expect(tokenSpy).not.toHaveBeenCalled();
  });
});

describe("reading through the client with the Vercel OIDC token", () => {
  test("lists runs from read API version 2 with the token as a bearer credential", async () => {
    await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    const sent = serveAnswers([
      Response.json({
        runs: [runSummary("new"), runSummary("old")],
        next_before: null,
      }),
    ]);

    const runs = await loadCollectorRuns("us", 60);

    expect(runs.map((run) => run.run_id)).toEqual(["new", "old"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url.origin + sent[0]?.url.pathname).toBe(
      `${COLLECTOR_URL}/v2/runs`,
    );
    expect(sent[0]?.url.searchParams.get("country")).toBe("US");
    expect(sent[0]?.url.searchParams.get("limit")).toBe("60");
    expect(sent[0]?.headers.get("Authorization")).toBe(
      `Bearer ${VERCEL_OIDC_TOKEN}`,
    );
    expect(sent[0]?.headers.has("X-Telemetry-Read-Token")).toBe(false);
    expect(readSecret).not.toHaveBeenCalled();
  });

  test("asks the UK's runs as GB and follows cursors for only the runs still needed", async () => {
    await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    const sent = serveAnswers([
      Response.json({
        runs: [runSummary("first", "GB")],
        next_before: "cursor-1",
      }),
      Response.json({ runs: [runSummary("second", "GB")], next_before: null }),
    ]);

    const runs = await loadCollectorRuns("uk", 60);

    expect(runs.map((run) => run.run_id)).toEqual(["first", "second"]);
    expect(sent.map((request) => request.url.searchParams.get("country"))).toEqual([
      "GB",
      "GB",
    ]);
    expect(sent.map((request) => request.url.searchParams.get("limit"))).toEqual([
      "60",
      "59",
    ]);
    expect(sent[1]?.url.searchParams.get("before")).toBe("cursor-1");
  });

  test("asks for the token again for every request", async () => {
    let issued = 0;
    const tokenSpy = await serveVercelOidcToken(() => `token-${(issued += 1)}`);
    const sent = serveAnswers([
      Response.json({ runs: [runSummary("run-1")], next_before: null }),
      Response.json(recordedBody("v2", "get-run-us-run-completed")),
    ]);

    await loadCollectorRuns("us", 60);
    await loadCollectorRun("us-run-completed", "us");

    expect(tokenSpy).toHaveBeenCalledTimes(2);
    expect(sent.map((request) => request.headers.get("Authorization"))).toEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  test("gives a run the documents version 1 gives for it", async () => {
    await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    const sent = serveAnswers([
      Response.json(recordedBody("v2", "get-run-us-run-completed")),
    ]);
    const version1 = recordedBody("v1", "get-run-us-run-completed");

    const run = await loadCollectorRun("us-run-completed", "us");

    expect(sent[0]?.url.toString()).toBe(
      `${COLLECTOR_URL}/v2/runs/us-run-completed`,
    );
    expect(withInstants(run)).toEqual(
      withInstants({
        run_id: "us-run-completed",
        source: "staging",
        country: "us",
        progress: version1.progress,
        run_manifest: version1.run_manifest,
        calibration_progress: version1.calibration_progress,
        events: version1.events,
      }),
    );
    expect(JSON.stringify(run)).not.toContain(VERCEL_OIDC_TOKEN);
  });

  test("answers a run the collector has no record of with a 404 collector error", async () => {
    await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    serveAnswers([
      Response.json({ detail: "Run was not found." }, { status: 404 }),
    ]);

    const failure = await loadCollectorRun("no-such-run", "us").catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(CollectorRequestError);
    expect((failure as CollectorRequestError).status).toBe(404);
  });

  test("keeps the status of any other refusal", async () => {
    await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    serveAnswers([
      Response.json(
        {
          detail:
            "This Vercel project and environment may not read this collector.",
        },
        { status: 403 },
      ),
    ]);

    const failure = await loadCollectorRuns("us", 60).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(CollectorRequestError);
    expect((failure as CollectorRequestError).status).toBe(403);
    expect((failure as Error).message).toBe(
      "Telemetry collector request failed (403).",
    );
  });

  test("refuses a run of another country", async () => {
    await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    serveAnswers([Response.json(recordedBody("v2", "get-run-gb-run-blocked"))]);

    await expect(loadCollectorRun("gb-run-blocked", "us")).rejects.toThrow(
      "Telemetry collector returned a run for another country.",
    );
  });

  test("sends each request to the collector address set when it is made", async () => {
    await serveVercelOidcToken(VERCEL_OIDC_TOKEN);
    const sent = serveAnswers([
      Response.json({ runs: [runSummary("first")], next_before: null }),
      Response.json({ runs: [runSummary("second")], next_before: null }),
    ]);

    await loadCollectorRuns("us", 60);
    process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = "https://other-telemetry.example";
    await loadCollectorRuns("us", 60);

    expect(sent.map((request) => request.url.origin)).toEqual([
      COLLECTOR_URL,
      "https://other-telemetry.example",
    ]);
  });

  test("sends nothing without a token", async () => {
    await serveVercelOidcToken(" ");
    const sent = serveAnswers([]);

    await expect(loadCollectorRuns("us", 60)).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});
