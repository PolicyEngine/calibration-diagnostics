import "server-only";

import type { BuildRunDocuments } from "@/lib/microcosm/build-monitor";
import type { MicrocosmCountry } from "@/lib/microcosm/countries";

type JsonObject = Record<string, unknown>;

export const TELEMETRY_COLLECTOR_URL_ENV = "MICROCOSM_TELEMETRY_COLLECTOR_URL";
export const TELEMETRY_COLLECTOR_READ_TOKEN_ENV =
  "MICROCOSM_TELEMETRY_COLLECTOR_READ_TOKEN";

export interface CollectorRunSummary extends JsonObject {
  run_id: string;
  country_code: string;
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

function collectorConfiguration(
  environment: Record<string, string | undefined> = process.env,
): { baseUrl: string; readToken: string } | null {
  const rawUrl = environment[TELEMETRY_COLLECTOR_URL_ENV]?.trim();
  const readToken = environment[TELEMETRY_COLLECTOR_READ_TOKEN_ENV]?.trim();
  if (!rawUrl || !readToken) return null;
  const url = new URL(rawUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Telemetry collector URL must use HTTPS except on localhost.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Telemetry collector URL must not contain credentials or query data.");
  }
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    readToken,
  };
}

export function collectorConfigured(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return collectorConfiguration(environment) !== null;
}

function collectorCountry(country: MicrocosmCountry): string {
  return country === "uk" ? "GB" : country.toUpperCase();
}

async function collectorJson(path: string): Promise<JsonObject> {
  const configuration = collectorConfiguration();
  if (!configuration) {
    throw new Error(
      `Configure ${TELEMETRY_COLLECTOR_URL_ENV} and ${TELEMETRY_COLLECTOR_READ_TOKEN_ENV}.`,
    );
  }
  const response = await fetch(`${configuration.baseUrl}${path}`, {
    cache: "no-store",
    headers: { "X-Telemetry-Read-Token": configuration.readToken },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Telemetry collector request failed (${response.status}).`);
  }
  return objectValue(await response.json(), "response");
}

function parseRunSummary(value: unknown): CollectorRunSummary {
  const row = objectValue(value, "run summary");
  return {
    ...row,
    run_id: stringValue(row.run_id, "run_id"),
    country_code: stringValue(row.country_code, "country_code"),
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

export async function loadCollectorRuns(
  country: MicrocosmCountry,
): Promise<CollectorRunSummary[]> {
  const runs: CollectorRunSummary[] = [];
  const visited = new Set<string>();
  let before: string | null = null;
  do {
    const params = new URLSearchParams({
      country: collectorCountry(country),
      limit: "200",
    });
    if (before) params.set("before", before);
    const page = parseRunPage(await collectorJson(`/v1/runs?${params}`));
    runs.push(...page.runs);
    before = page.next_before;
    if (before) {
      if (visited.has(before)) {
        throw new Error("Telemetry collector pagination repeated a cursor.");
      }
      visited.add(before);
    }
  } while (before);
  return runs;
}

export async function loadCollectorRun(
  runId: string,
  country: MicrocosmCountry,
): Promise<BuildRunDocuments> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(runId)) {
    throw new Error("Telemetry collector run id is invalid.");
  }
  const payload = await collectorJson(`/v1/runs/${encodeURIComponent(runId)}`);
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
      payload.progress == null ? null : objectValue(payload.progress, "progress"),
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
