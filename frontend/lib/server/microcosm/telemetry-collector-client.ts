import "server-only";

import {
  type CollectorClient,
  CollectorRequestError as ClientRequestError,
  createCollectorClient,
} from "@policyengine/microcosm-collector-client";
import type { BuildRunDocuments } from "@/lib/microcosm/build-monitor";
import { runDocuments } from "@/lib/microcosm/collector-run-documents";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import { secretManager, validSecretVersion } from "@/lib/server/secret-manager";
import { vercelOidc } from "@/lib/server/vercel-oidc";

type JsonObject = Record<string, unknown>;

export const TELEMETRY_COLLECTOR_URL_ENV = "MICROCOSM_TELEMETRY_COLLECTOR_URL";
export const TELEMETRY_READ_SECRET_VERSION_ENV =
  "MICROCOSM_TELEMETRY_READ_SECRET_VERSION";
// `1` reads the collector's read API v2 through its typed client,
// authenticated with the deployment's Vercel OIDC token; unset, empty or `0`
// reads version 1 with the read credential from Secret Manager.
export const TELEMETRY_VERCEL_OIDC_ENV = "MICROCOSM_TELEMETRY_VERCEL_OIDC";
const COLLECTOR_TIMEOUT_MS = 30_000;

// A run's row in the collector's run list (`GET /v1/runs`). The dashboard
// reuses a run's record while these fields are unchanged.
export interface CollectorRunSummary extends JsonObject {
  run_id: string;
  country_code: string;
  status: string;
  updated_at: string;
  started_at?: string | null;
  current_stage?: string | null;
  ended_at?: string | null;
  heartbeat_at?: string | null;
}

// A collector request that answered with an HTTP error, such as 404 for a
// run it has no record of.
export class CollectorRequestError extends Error {
  constructor(readonly status: number) {
    super(`Telemetry collector request failed (${status}).`);
    this.name = "CollectorRequestError";
  }
}

interface CollectorRunPage {
  runs: CollectorRunSummary[];
  next_before: string | null;
}

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Telemetry collector ${label} must be an object.`);
  }
  return value as JsonObject;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Telemetry collector ${label} must be a non-empty string.`);
  }
  return value;
}

type CollectorConfiguration =
  | { baseUrl: string; credential: "read-secret"; secretVersion: string }
  | { baseUrl: string; credential: "vercel-oidc" };

function readsWithVercelOidc(
  environment: Record<string, string | undefined>,
): boolean {
  const value = environment[TELEMETRY_VERCEL_OIDC_ENV]?.trim() ?? "";
  if (value === "1") return true;
  if (value === "" || value === "0") return false;
  throw new Error(`${TELEMETRY_VERCEL_OIDC_ENV} must be 1 or 0.`);
}

function collectorConfiguration(
  environment: Record<string, string | undefined> = process.env,
): CollectorConfiguration | null {
  const withVercelOidc = readsWithVercelOidc(environment);
  const rawUrl = environment[TELEMETRY_COLLECTOR_URL_ENV]?.trim();
  const secretVersion = environment[TELEMETRY_READ_SECRET_VERSION_ENV]?.trim();
  if (!rawUrl || (!withVercelOidc && !secretVersion)) return null;
  if (!withVercelOidc && !validSecretVersion(secretVersion ?? "")) {
    throw new Error("Invalid telemetry read credential resource.");
  }
  const url = new URL(rawUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      "Telemetry collector URL must use HTTPS except on localhost.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Telemetry collector URL must not contain credentials or query data.",
    );
  }
  const baseUrl = url.toString().replace(/\/$/, "");
  return withVercelOidc
    ? { baseUrl, credential: "vercel-oidc" }
    : { baseUrl, credential: "read-secret", secretVersion: secretVersion ?? "" };
}

export function collectorConfigured(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return collectorConfiguration(environment) !== null;
}

function collectorCountry(country: MicrocosmCountry): string {
  return country === "uk" ? "GB" : country.toUpperCase();
}

function requireConfiguration(): CollectorConfiguration {
  const configuration = collectorConfiguration();
  if (!configuration) {
    throw new Error(
      `Configure ${TELEMETRY_COLLECTOR_URL_ENV} and ${TELEMETRY_READ_SECRET_VERSION_ENV}, or ${TELEMETRY_COLLECTOR_URL_ENV} and ${TELEMETRY_VERCEL_OIDC_ENV}=1.`,
    );
  }
  return configuration;
}

// Read API v1, with the read credential from Secret Manager.
async function collectorJson(
  configuration: Extract<CollectorConfiguration, { credential: "read-secret" }>,
  path: string,
): Promise<JsonObject> {
  const readToken = await secretManager.readVersion(
    configuration.secretVersion,
  );
  const response = await fetch(`${configuration.baseUrl}${path}`, {
    cache: "no-store",
    headers: { "X-Telemetry-Read-Token": readToken },
    signal: AbortSignal.timeout(COLLECTOR_TIMEOUT_MS),
  });
  if (!response.ok) throw new CollectorRequestError(response.status);
  return objectValue(await response.json(), "response");
}

// Read API v2 through the collector's typed client, with the deployment's
// Vercel OIDC token, which the client asks for before every request. One
// client per collector address.
let versionTwoClient: { baseUrl: string; client: CollectorClient } | null =
  null;

function collectorClient(baseUrl: string): CollectorClient {
  if (versionTwoClient?.baseUrl !== baseUrl) {
    versionTwoClient = {
      baseUrl,
      client: createCollectorClient({
        baseUrl,
        vercelOidcToken: () => vercelOidc.token(),
        timeoutMs: COLLECTOR_TIMEOUT_MS,
      }),
    };
  }
  return versionTwoClient.client;
}

// The client's error answers as this module's, so callers tell a missing run
// (404) from other failures the same way for both versions.
async function throughClient<Result>(
  request: () => Promise<Result>,
): Promise<Result> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ClientRequestError) {
      throw new CollectorRequestError(error.status);
    }
    throw error;
  }
}

function parseRunSummary(value: unknown): CollectorRunSummary {
  const row = objectValue(value, "run summary");
  return {
    ...row,
    run_id: stringValue(row.run_id, "run_id"),
    country_code: stringValue(row.country_code, "country_code"),
    status: stringValue(row.status, "status"),
    updated_at: stringValue(row.updated_at, "updated_at"),
  };
}

function parseRunPage(value: JsonObject): CollectorRunPage {
  if (!Array.isArray(value.runs)) {
    throw new Error("Telemetry collector run page must contain a runs array.");
  }
  const next = value.next_before;
  if (next !== null && typeof next !== "string") {
    throw new Error("Telemetry collector pagination cursor is invalid.");
  }
  return {
    runs: value.runs.map(parseRunSummary),
    next_before: next,
  };
}

// The collector rejects a `GET /v1/runs` page larger than this.
const COLLECTOR_MAX_PAGE_SIZE = 200;

// The country's `limit` most recent runs, newest first. Each page asks only for
// the runs still needed, so the dashboard never reads the full history.
export async function loadCollectorRuns(
  country: MicrocosmCountry,
  limit: number,
): Promise<CollectorRunSummary[]> {
  const configuration = requireConfiguration();
  if (configuration.credential === "vercel-oidc") {
    const client = collectorClient(configuration.baseUrl);
    const listed = await throughClient(() =>
      client.listRecentRuns({ country: collectorCountry(country), count: limit }),
    );
    return listed.map(parseRunSummary);
  }
  const runs: CollectorRunSummary[] = [];
  const visited = new Set<string>();
  let before: string | null = null;
  do {
    const params = new URLSearchParams({
      country: collectorCountry(country),
      limit: String(Math.min(limit - runs.length, COLLECTOR_MAX_PAGE_SIZE)),
    });
    if (before) params.set("before", before);
    const page = parseRunPage(
      await collectorJson(configuration, `/v1/runs?${params}`),
    );
    runs.push(...page.runs);
    before = page.next_before;
    if (before) {
      if (visited.has(before)) {
        throw new Error("Telemetry collector pagination repeated a cursor.");
      }
      visited.add(before);
    }
  } while (before && runs.length < limit);
  return runs.slice(0, limit);
}

export async function loadCollectorRun(
  runId: string,
  country: MicrocosmCountry,
): Promise<BuildRunDocuments> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(runId)) {
    throw new Error("Telemetry collector run id is invalid.");
  }
  const configuration = requireConfiguration();
  if (configuration.credential === "vercel-oidc") {
    return loadCollectorRunThroughClient(configuration.baseUrl, runId, country);
  }
  const payload = await collectorJson(
    configuration,
    `/v1/runs/${encodeURIComponent(runId)}`,
  );
  const payloadRunId = stringValue(payload.run_id, "run_id");
  const countryCode = stringValue(payload.country_code, "country_code");
  if (payloadRunId !== runId) {
    throw new Error("Telemetry collector returned a different run id.");
  }
  if (countryCode !== collectorCountry(country)) {
    throw new Error("Telemetry collector returned a run for another country.");
  }
  if (!Array.isArray(payload.events)) {
    throw new Error("Telemetry collector run must contain an events array.");
  }
  return {
    run_id: runId,
    source: "staging",
    country,
    progress:
      payload.progress == null
        ? null
        : objectValue(payload.progress, "progress"),
    run_manifest:
      payload.run_manifest == null
        ? null
        : objectValue(payload.run_manifest, "run manifest"),
    calibration_progress:
      payload.calibration_progress == null
        ? null
        : objectValue(payload.calibration_progress, "calibration progress"),
    events: payload.events.map((event, index) =>
      objectValue(event, `event ${index}`),
    ),
  };
}

async function loadCollectorRunThroughClient(
  baseUrl: string,
  runId: string,
  country: MicrocosmCountry,
): Promise<BuildRunDocuments> {
  const client = collectorClient(baseUrl);
  const detail = await throughClient(() => client.getRun(runId));
  // The client answers null for a run the collector has no record of.
  if (detail === null) throw new CollectorRequestError(404);
  if (detail.run.country_code !== collectorCountry(country)) {
    throw new Error("Telemetry collector returned a run for another country.");
  }
  return {
    run_id: runId,
    source: "staging",
    country,
    ...runDocuments(detail as unknown as JsonObject),
  };
}
