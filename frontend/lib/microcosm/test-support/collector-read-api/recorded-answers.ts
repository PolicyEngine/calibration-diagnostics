// Test support: the collector's recorded answers to read API v1 and v2 for the
// same stored telemetry, copied from PolicyEngine/microcosm-collector at
// `d78770b` (release 0.19.0): `tests/fixtures/read_api_v1/get-run-*.json`
// into `v1/`, and `contracts/read-api-v2/interactions/get-run-*.json` and
// `list-runs.json` into `v2/`.
import { readFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

export const RECORDED_RUNS = [
  "us-run-completed",
  "us-run-failed",
  "gb-run-blocked",
  "gb-run-restarted",
  "us-run-registered",
  "us-run-with-readings",
] as const;

const RECORDED_ANSWERS = new URL("./", import.meta.url);

// The body of the recorded answer `name` (such as `get-run-us-run-failed` or
// `list-runs`) of read API `version`.
export function recordedBody(version: "v1" | "v2", name: string): JsonObject {
  const recorded = JSON.parse(
    readFileSync(new URL(`${version}/${name}.json`, RECORDED_ANSWERS), "utf8"),
  ) as { response: { status: number; body: JsonObject } };
  if (recorded.response.status !== 200) {
    throw new Error(`The recorded answer ${version}/${name} is not a 200.`);
  }
  return recorded.response.body;
}

// Version 2 writes every time in UTC as `...Z`; version 1 keeps the
// `+00:00` that times nested in a run's work or reading had when stored. The
// build monitor parses both, so comparisons are by instant: every string that
// is a whole ISO 8601 time with an offset becomes `toISOString()`'s text.
const ZONED_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function withInstants(value: unknown): unknown {
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
