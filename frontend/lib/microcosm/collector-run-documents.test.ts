import { describe, expect, test } from "bun:test";

import {
  RECORDED_RUNS,
  recordedBody,
  withInstants,
} from "@/lib/microcosm/test-support/collector-read-api/recorded-answers";

// The collector's recorded answers to read API v1 and v2 for the same stored
// telemetry (see `recorded-answers`). The v2 run, converted, must give exactly
// the documents v1 gives for it.

type JsonObject = Record<string, unknown>;
type RunDocumentsFunction = (detail: JsonObject) => JsonObject;

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

function eventsOf(value: JsonObject): JsonObject[] {
  return value.events as JsonObject[];
}

describe("a read API v2 run converted into the v1 documents", () => {
  for (const runId of RECORDED_RUNS) {
    test(`${runId} gives the documents version 1 recorded`, async () => {
      const runDocuments = await conversion();
      const version1 = recordedBody("v1", `get-run-${runId}`);

      const converted = runDocuments(recordedBody("v2", `get-run-${runId}`));

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

  test("keeps the events in the order the collector applies them, numbered from 1", async () => {
    const runDocuments = await conversion();
    const detail = recordedBody("v2", "get-run-gb-run-restarted");

    const converted = runDocuments(detail);

    expect(eventsOf(converted).map((event) => event.event_id)).toEqual(
      eventsOf(detail).map((event) => event.event_id),
    );
    expect(eventsOf(converted).map((event) => event.sequence)).toEqual(
      eventsOf(detail).map((_, index) => index + 1),
    );
  });

  test("takes the identity of the last run event that has one", async () => {
    const runDocuments = await conversion();
    const detail = recordedBody("v2", "get-run-us-run-completed");
    const firstRunEvent = eventsOf(detail).find(
      (event) => event.event_type === "run",
    );
    expect(firstRunEvent).toBeDefined();
    const laterIdentity = { microcosm_version: "9.9.9", country: "us" };
    const withLaterRestart = {
      ...detail,
      events: [
        ...eventsOf(detail),
        {
          ...firstRunEvent,
          event_id: "a-later-restart",
          details: { identity: laterIdentity },
        },
        {
          ...firstRunEvent,
          event_id: "a-run-event-without-identity",
          details: {},
        },
      ],
    };

    const converted = runDocuments(withLaterRestart);

    expect((converted.run_manifest as JsonObject).identity).toEqual(
      laterIdentity,
    );
  });
});
