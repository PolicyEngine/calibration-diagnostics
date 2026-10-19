// Test support: an in-memory telemetry collector behind a fetch stub. It
// serves `GET /v1/runs` the way the collector does (newest first, a `limit`
// between 1 and 200 that defaults to 60, an opaque `before` cursor, and a
// cursor whenever a page is full) and `GET /v1/runs/{run_id}`, and records
// every request so tests can bound what the dashboard asks for.

export const FAKE_COLLECTOR_URL = "https://telemetry.example";

const COLLECTOR_DEFAULT_LIMIT = 60;
const COLLECTOR_MAX_LIMIT = 200;
const NEWEST_REGISTRATION_MS = Date.parse("2026-10-05T10:00:00Z");

// A type alias, not an interface, so it satisfies the client's JSON-object
// summary type.
export type FakeCollectorRunSummary = {
  run_id: string;
  country_code: string;
  pipeline: string;
  candidate_id: string | null;
  release_id: string | null;
  run_kind: string;
  status: string;
  current_stage: string;
  registered_at: string;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  heartbeat_at: string | null;
};

export interface FakeTelemetryCollectorOptions {
  countryCode: string;
  runCount: number;
  // Serve at most this many runs per page, with a cursor, so tests can cross
  // page boundaries below the requested limit.
  largestPage?: number;
}

export interface FakeTelemetryCollector {
  // Every stored run, newest first: the collector's listing order.
  runs: FakeCollectorRunSummary[];
  listRequests: URL[];
  // The `next_before` cursor served for each list request, in order.
  servedCursors: (string | null)[];
  documentRequests: string[];
  fetch: typeof fetch;
}

function summaryForRun(
  countryCode: string,
  ageIndex: number,
  runCount: number,
): FakeCollectorRunSummary {
  const registeredAt = new Date(
    NEWEST_REGISTRATION_MS - ageIndex * 60_000,
  ).toISOString();
  const finished = ageIndex > 0;
  return {
    run_id: `run-${String(runCount - ageIndex).padStart(4, "0")}`,
    country_code: countryCode,
    pipeline: "fiscal-refresh",
    candidate_id: null,
    release_id: null,
    run_kind: "calibration",
    status: finished ? "completed" : "running",
    current_stage: finished ? "complete" : "target_compilation",
    registered_at: registeredAt,
    started_at: registeredAt,
    updated_at: registeredAt,
    ended_at: finished ? registeredAt : null,
    heartbeat_at: null,
  };
}

function pageCursor(run: FakeCollectorRunSummary): string {
  return Buffer.from(JSON.stringify([run.registered_at, run.run_id])).toString(
    "base64url",
  );
}

function runIdFromCursor(cursor: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
    return Array.isArray(decoded) && typeof decoded[1] === "string"
      ? decoded[1]
      : null;
  } catch {
    return null;
  }
}

function runDocuments(run: FakeCollectorRunSummary) {
  return {
    run_id: run.run_id,
    country_code: run.country_code,
    progress: {
      schema_version: 2,
      run_id: run.run_id,
      country_code: run.country_code,
      pipeline: { id: run.pipeline, version: "collector-v1" },
      started_at: run.started_at,
      updated_at: run.updated_at,
      status: run.status,
      current_stage: run.current_stage,
    },
    run_manifest: null,
    calibration_progress: null,
    events: [
      {
        schema_version: 2,
        sequence: 1,
        run_id: run.run_id,
        event_type: "stage",
        stage_id: run.current_stage,
        stage: run.current_stage,
        status: run.status === "running" ? "started" : "completed",
        timestamp: run.updated_at,
        time: run.updated_at,
        details: {},
      },
    ],
  };
}

export function fakeTelemetryCollector({
  countryCode,
  runCount,
  largestPage,
}: FakeTelemetryCollectorOptions): FakeTelemetryCollector {
  const runs = Array.from({ length: runCount }, (_, ageIndex) =>
    summaryForRun(countryCode, ageIndex, runCount),
  );
  const listRequests: URL[] = [];
  const servedCursors: (string | null)[] = [];
  const documentRequests: string[] = [];

  function listRuns(url: URL): Response {
    listRequests.push(url);
    if (url.searchParams.get("country") !== countryCode) {
      return Response.json({ runs: [], next_before: null });
    }
    const limit = Number(
      url.searchParams.get("limit") ?? COLLECTOR_DEFAULT_LIMIT,
    );
    if (!Number.isInteger(limit) || limit < 1 || limit > COLLECTOR_MAX_LIMIT) {
      return Response.json({ detail: "Invalid limit." }, { status: 422 });
    }
    let start = 0;
    const cursor = url.searchParams.get("before");
    if (cursor != null) {
      const cursorRunId = runIdFromCursor(cursor);
      const cursorIndex = runs.findIndex((run) => run.run_id === cursorRunId);
      if (cursorIndex < 0) {
        return Response.json(
          { detail: "Pagination cursor is invalid." },
          { status: 422 },
        );
      }
      start = cursorIndex + 1;
    }
    const servedSize = Math.min(limit, largestPage ?? limit);
    const page = runs.slice(start, start + servedSize);
    const nextBefore =
      page.length === servedSize ? pageCursor(page[page.length - 1]) : null;
    servedCursors.push(nextBefore);
    return Response.json({ runs: page, next_before: nextBefore });
  }

  function loadRun(runId: string): Response {
    documentRequests.push(runId);
    const run = runs.find((candidate) => candidate.run_id === runId);
    if (!run) {
      return Response.json({ detail: "Run was not found." }, { status: 404 });
    }
    return Response.json(runDocuments(run));
  }

  const collectorFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin !== FAKE_COLLECTOR_URL) {
      throw new Error(`Unexpected request outside the collector: ${url.origin}`);
    }
    if (url.pathname === "/v1/runs") return listRuns(url);
    const documentPath = /^\/v1\/runs\/([^/]+)$/.exec(url.pathname);
    if (documentPath) return loadRun(decodeURIComponent(documentPath[1]));
    throw new Error(`Unexpected collector path: ${url.pathname}`);
  }) as typeof fetch;

  return {
    runs,
    listRequests,
    servedCursors,
    documentRequests,
    fetch: collectorFetch,
  };
}

// Every run the collector lists for a country, read the way the dashboard did
// before the listing was bounded: 200-run pages, following every cursor.
export async function entireCollectorHistory(
  collector: FakeTelemetryCollector,
  countryCode: string,
): Promise<FakeCollectorRunSummary[]> {
  const history: FakeCollectorRunSummary[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({
      country: countryCode,
      limit: String(COLLECTOR_MAX_LIMIT),
    });
    if (cursor) params.set("before", cursor);
    const response = await collector.fetch(
      `${FAKE_COLLECTOR_URL}/v1/runs?${params}`,
    );
    const page = (await response.json()) as {
      runs: FakeCollectorRunSummary[];
      next_before: string | null;
    };
    history.push(...page.runs);
    cursor = page.next_before;
  } while (cursor);
  return history;
}
