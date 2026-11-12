import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import {
  clearBuildRunCaches,
  loadBuildRun,
  loadBuildRuns,
} from "@/lib/microcosm/build-runs";
import {
  FAKE_COLLECTOR_URL,
  fakeTelemetryCollector,
} from "@/lib/microcosm/test-support/fake-telemetry-collector";
import { recordedBody } from "@/lib/microcosm/test-support/collector-read-api/recorded-answers";
import { secretManager } from "@/lib/server/secret-manager";
import { vercelOidc } from "@/lib/server/vercel-oidc";

// With MICROCOSM_BUILD_MONITOR_COLLECTOR_ONLY=1 the Build progress tab reads
// build telemetry only from the collector: neither its run list nor a run's
// detail reads the run files builds wrote to the Hugging Face staging
// repositories.

const SETTING = "MICROCOSM_BUILD_MONITOR_COLLECTOR_ONLY";
const SETTINGS = [
  "MICROCOSM_TELEMETRY_COLLECTOR_URL",
  "MICROCOSM_TELEMETRY_READ_SECRET_VERSION",
  "MICROCOSM_TELEMETRY_VERCEL_OIDC",
  SETTING,
] as const;
const READ_SECRET_VERSION =
  "projects/test-project/secrets/collector-read/versions/latest";
const HUGGING_FACE = "https://huggingface.co";

const originalFetch = globalThis.fetch;
const originalSettings = Object.fromEntries(
  SETTINGS.map((name) => [name, process.env[name]]),
);
const readSecret = spyOn(secretManager, "readVersion");

beforeEach(() => {
  clearBuildRunCaches();
  readSecret.mockResolvedValue("secret-read-token");
  process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL = FAKE_COLLECTOR_URL;
  process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION = READ_SECRET_VERSION;
  delete process.env.MICROCOSM_TELEMETRY_VERCEL_OIDC;
  process.env[SETTING] = "1";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  readSecret.mockReset();
  for (const name of SETTINGS) {
    const original = originalSettings[name];
    if (original == null) delete process.env[name];
    else process.env[name] = original;
  }
  clearBuildRunCaches();
});

// The US has a Hugging Face staging repository, so without the setting the
// build list reads its run files too. Requests to Hugging Face are recorded
// and answered as Hugging Face answers a file it doesn't have.
function serveUsCollector(runCount: number) {
  const collector = fakeTelemetryCollector({ countryCode: "US", runCount });
  const huggingFaceRequests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin === HUGGING_FACE) {
      huggingFaceRequests.push(url.toString());
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }
    return collector.fetch(input);
  }) as typeof fetch;
  return { collector, huggingFaceRequests };
}

describe("the Build progress tab with Hugging Face run files off", () => {
  test("lists the collector's runs without asking Hugging Face", async () => {
    const { collector, huggingFaceRequests } = serveUsCollector(3);

    const response = await loadBuildRuns("staging", "us");

    expect(response.available).toBe(true);
    expect(response.problems).toEqual([]);
    expect(response.runs.map((run) => run.run_id).toSorted()).toEqual(
      collector.runs.map((run) => run.run_id).toSorted(),
    );
    expect(huggingFaceRequests).toEqual([]);
  });

  test("a run's detail comes from the collector without asking Hugging Face", async () => {
    const { collector, huggingFaceRequests } = serveUsCollector(3);
    const runId = collector.runs[0].run_id;

    const detail = await loadBuildRun("staging", "us", runId);

    expect(detail?.run.run_id).toBe(runId);
    expect(huggingFaceRequests).toEqual([]);
  });

  test("a run the collector has no record of is not found, without asking Hugging Face", async () => {
    const { huggingFaceRequests } = serveUsCollector(3);

    const detail = await loadBuildRun("staging", "us", "only-on-hugging-face");

    expect(detail).toBeNull();
    expect(huggingFaceRequests).toEqual([]);
  });

  test("a run id the collector refuses is not found, without asking Hugging Face", async () => {
    const { collector, huggingFaceRequests } = serveUsCollector(3);

    for (const malformed of ["not/a-run", "-starts-with-a-dash"]) {
      const detail = await loadBuildRun("staging", "us", malformed).catch(
        (error: unknown) => error,
      );
      expect(detail).toBeNull();
    }
    expect(collector.documentRequests).toEqual([]);
    expect(huggingFaceRequests).toEqual([]);
  });

  test("with the Vercel OIDC token too, the list comes from read API v2 alone", async () => {
    process.env.MICROCOSM_TELEMETRY_VERCEL_OIDC = "1";
    delete process.env.MICROCOSM_TELEMETRY_READ_SECRET_VERSION;
    const tokenSpy = spyOn(vercelOidc, "token").mockResolvedValue("oidc-token");
    const listed = (recordedBody("v2", "list-runs").runs as Record<string, unknown>[])
      .filter((run) => run.country_code === "US");
    const sentPaths: string[] = [];
    const huggingFaceRequests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === HUGGING_FACE) {
        huggingFaceRequests.push(url.toString());
        return Response.json({ error: "Entry not found" }, { status: 404 });
      }
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer oidc-token");
      sentPaths.push(url.pathname);
      if (url.pathname === "/v2/runs") {
        return Response.json({ runs: listed, next_before: null });
      }
      const runId = decodeURIComponent(url.pathname.replace("/v2/runs/", ""));
      return Response.json(recordedBody("v2", `get-run-${runId}`));
    }) as typeof fetch;
    try {
      const response = await loadBuildRuns("staging", "us");

      expect(response.problems).toEqual([]);
      expect(response.runs.map((run) => run.run_id).toSorted()).toEqual(
        listed.map((run) => run.run_id as string).toSorted(),
      );
      expect(sentPaths[0]).toBe("/v2/runs");
      expect(huggingFaceRequests).toEqual([]);
      expect(readSecret).not.toHaveBeenCalled();
    } finally {
      tokenSpy.mockRestore();
    }
  });

  test("without a configured collector the hosted runs are unavailable and Hugging Face is not asked", async () => {
    const { huggingFaceRequests } = serveUsCollector(3);
    delete process.env.MICROCOSM_TELEMETRY_COLLECTOR_URL;

    const response = await loadBuildRuns("staging", "us");

    expect(response.available).toBe(false);
    expect(response.runs).toEqual([]);
    expect(response.detail).toBe(
      "The telemetry collector is not configured on this server.",
    );
    expect(huggingFaceRequests).toEqual([]);
  });

  test("a collector failure is reported, with no Hugging Face runs in its place", async () => {
    const huggingFaceRequests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === HUGGING_FACE) {
        huggingFaceRequests.push(url.toString());
        return Response.json({ error: "Entry not found" }, { status: 404 });
      }
      return Response.json({ detail: "Unavailable." }, { status: 503 });
    }) as typeof fetch;

    const response = await loadBuildRuns("staging", "us");

    expect(response.available).toBe(false);
    expect(response.runs).toEqual([]);
    expect(response.problems).toEqual([
      { run_id: "collector", detail: "Telemetry collector request failed (503)." },
    ]);
    expect(huggingFaceRequests).toEqual([]);
  });

  test("a value other than 1 or 0 is refused", async () => {
    serveUsCollector(1);
    process.env[SETTING] = "yes";

    await expect(loadBuildRuns("staging", "us")).rejects.toThrow(
      "MICROCOSM_BUILD_MONITOR_COLLECTOR_ONLY must be 1 or 0.",
    );
  });
});

describe("the Build progress tab with the setting off", () => {
  for (const off of [undefined, "", "0"]) {
    test(`still reads the Hugging Face run files when the setting is ${JSON.stringify(off ?? null)}`, async () => {
      const { huggingFaceRequests } = serveUsCollector(1);
      if (off === undefined) delete process.env[SETTING];
      else process.env[SETTING] = off;

      await loadBuildRuns("staging", "us");

      expect(huggingFaceRequests.length).toBeGreaterThan(0);
    });
  }
});
