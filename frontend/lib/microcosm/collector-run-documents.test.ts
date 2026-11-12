import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The collector's recorded answers to read API v1 and v2 for the same stored
// telemetry: `tests/fixtures/read_api_v1/get-run-*.json` and
// `contracts/read-api-v2/interactions/get-run-*.json` in
// PolicyEngine/microcosm-collector at `d78770b` (release 0.19.0). The v2 run,
// converted, must give exactly the documents v1 gives for it.
const RECORDED_RUNS = [
  "us-run-completed",
  "us-run-failed",
  "gb-run-blocked",
  "gb-run-restarted",
  "us-run-registered",
  "us-run-with-readings",
] as const;

const RECORDED_ANSWERS = new URL(
  "./test-support/collector-read-api/",
  import.meta.url,
);

type JsonObject = Record<string, unknown>;

function recordedBody(version: "v1" | "v2", runId: string): JsonObject {
  const recorded = JSON.parse(
    readFileSync(new URL(`${version}/get-run-${runId}.json`, RECORDED_ANSWERS), "utf8"),
  ) as { response: { status: number; body: JsonObject } };
  expect(recorded.response.status).toBe(200);
  return recorded.response.body;
}

type RunDocumentsFunction = (detail: JsonObject) => JsonObject;

// Version 2 writes every time in UTC as `...Z`; version 1 keeps the
// `+00:00` that times nested in a run's work or reading had when stored. The
// build monitor parses both, so the comparison is by instant.
const ZONED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function withInstants(value: unknown): unknown {
  if (typeof value === "string" && ZONED_TIME.test(value)) {
    return new Date(value).toISOString();
  }
  if (Array.isArray(value)) return value.map(withInstants);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withInstants(item)]),
    );
  }
  return value;
}

// Imported here rather than at the top, so that without the module each test
// fails on this assertion instead of the file failing to load.
async function conversion(): Promise<RunDocumentsFunction> {
  const loaded = await import("@/lib/microcosm/collector-run-documents").catch(
    () => null,
  );
  expect(loaded).not.toBeNull();
  return (loaded as unknown as { runDocuments: RunDocumentsFunction })
    .runDocuments;
}

describe("a read API v2 run converted into the v1 documents", () => {
  for (const runId of RECORDED_RUNS) {
    test(`${runId} gives the documents version 1 recorded`, async () => {
      const runDocuments = await conversion();
      const version1 = recordedBody("v1", runId);

      const converted = runDocuments(recordedBody("v2", runId));

      expect(withInstants(converted)).toEqual(
        withInstants({
          progress: version1.progress,
          run_manifest: version1.run_manifest,
          calibration_progress: version1.calibration_progress,
          events: version1.events,
        }),
      );
    });
  }

  test("numbers the lifecycle events in the order the collector applies them", async () => {
    const runDocuments = await conversion();

    const converted = runDocuments(recordedBody("v2", "gb-run-restarted"));

    expect(
      (converted.events as { sequence: number }[]).map((event) => event.sequence),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  test("does not change the answer it converts", async () => {
    const runDocuments = await conversion();
    const detail = recordedBody("v2", "us-run-completed");
    const before = structuredClone(detail);

    const converted = runDocuments(detail);
    (converted.events as { details: JsonObject }[])[0].details.changed = true;

    expect(detail).toEqual(before);
  });
});
