import { parseArgs } from "node:util";

import {
  hasCapability,
  selectableCountries,
  type MicrocosmCountry,
} from "../lib/microcosm/countries";

type JsonObject = Record<string, unknown>;
type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;
const RETRY_BACKOFF_MS = [1000, 2000];

interface CalibrationDeploymentOptions {
  // The mounted dashboard root, e.g. https://candidate.vercel.app/calibration/dashboard.
  url: string;
  bypassSecret?: string;
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface CalibrationDeploymentReceipt {
  country: MicrocosmCountry;
  releaseId: string;
  stagingChecked: boolean;
}

function record(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

async function errorDetail(
  response: Response,
  options: CalibrationDeploymentOptions,
): Promise<string> {
  if (!response.headers.get("content-type")?.includes("application/json"))
    return "";
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return "";
    const rawDetail = (body as JsonObject).detail;
    if (typeof rawDetail !== "string") return "";
    let detail = rawDetail;
    const credentials = [
      options.bypassSecret,
      ...Object.entries(process.env)
        .filter(([name]) => /(?:TOKEN|SECRET|KEY)$/.test(name))
        .map(([, value]) => value),
    ];
    for (const credential of credentials) {
      if (credential) detail = detail.split(credential).join("[redacted]");
    }
    return detail
      .replace(/\bhf_[A-Za-z0-9_-]+\b/g, "[redacted]")
      .replace(/\bBearer\s+\S+/gi, "[redacted]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  } catch {
    // Invalid/HTML error responses must not interfere with 5xx retries.
    return "";
  }
}

async function requestJson(
  options: CalibrationDeploymentOptions,
  path: string,
  country: MicrocosmCountry,
  label: string,
): Promise<JsonObject> {
  const url = new URL(options.url);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Use a dashboard root URL without credentials, query, or fragment.",
    );
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/microcosm${path}`;
  url.searchParams.set("country", country);
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: options.bypassSecret
          ? { "x-vercel-protection-bypass": options.bypassSecret }
          : {},
        cache: "no-store",
        // Never forward a preview's bypass credential to a redirect destination.
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      if (attempt < RETRY_BACKOFF_MS.length) {
        await sleep(RETRY_BACKOFF_MS[attempt]);
        continue;
      }
      // Fetch exceptions can contain credentials or arbitrary response text.
      throw new Error(
        `${country} ${label} failed after 3 attempts due to a network error.`,
      );
    }
    if (
      response.status >= 500 &&
      response.status <= 599 &&
      attempt < RETRY_BACKOFF_MS.length
    ) {
      await sleep(RETRY_BACKOFF_MS[attempt]);
      continue;
    }
    if (response.status !== 200) {
      const detail = await errorDetail(response, options);
      throw new Error(
        `${country} ${label} returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
      );
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`${country} ${label} did not return JSON.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`${country} ${label} did not return valid JSON.`);
      }
      if (attempt < RETRY_BACKOFF_MS.length) {
        await sleep(RETRY_BACKOFF_MS[attempt]);
        continue;
      }
      throw new Error(
        `${country} ${label} failed after 3 attempts due to a network error.`,
      );
    }
    return record(body, `${country} ${label}`);
  }
  throw new Error(`${country} ${label} exceeded its request attempts.`);
}

export async function verifyCalibrationDeployment(
  options: CalibrationDeploymentOptions,
): Promise<CalibrationDeploymentReceipt[]> {
  const receipts: CalibrationDeploymentReceipt[] = [];
  // The registry defines supported countries, including private releases;
  // adding a country automatically extends deployment qualification.
  for (const country of selectableCountries()) {
    if (!hasCapability(country, "calibration")) continue;
    const summary = await requestJson(
      options,
      "",
      country,
      "calibration summary",
    );
    const calibration = record(
      summary.calibration,
      `${country} calibration summary`,
    );
    const identity = record(
      calibration.country,
      `${country} calibration summary country`,
    );
    const releaseId = summary.release_id;
    if (
      typeof releaseId !== "string" ||
      !releaseId.trim() ||
      calibration.available !== true ||
      identity.code !== country ||
      typeof calibration.total_targets !== "number" ||
      !Number.isSafeInteger(calibration.total_targets) ||
      calibration.total_targets <= 0
    ) {
      throw new Error(
        `${country} calibration summary is unavailable or inconsistent.`,
      );
    }

    const inventory = await requestJson(
      options,
      "/releases",
      country,
      "release inventory",
    );
    const releases = inventory.releases;
    if (
      inventory.default_release_id !== releaseId ||
      inventory.latest_release_id !== releaseId ||
      !Array.isArray(releases) ||
      !releases.some((entry: unknown) => {
        const release = record(entry, `${country} release inventory entry`);
        return (
          release.release_id === releaseId && release.has_calibration === true
        );
      })
    ) {
      throw new Error(
        `${country} release inventory does not contain its selected release.`,
      );
    }

    const stagingChecked = hasCapability(country, "staging");
    if (stagingChecked) {
      const staging = await requestJson(
        options,
        "/staging/runs",
        country,
        "staging inventory",
      );
      // The staging route returns 200 for unavailable private repositories.
      if (staging.available !== true || !Array.isArray(staging.runs)) {
        throw new Error(`${country} staging is unavailable.`);
      }
    }
    receipts.push({ country, releaseId, stagingChecked });
  }
  return receipts;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        url: { type: "string" },
        "vercel-bypass-secret": { type: "string" },
      },
    });
    if (!values.url)
      throw new Error("--url must name the mounted dashboard root.");
    const receipts = await verifyCalibrationDeployment({
      url: values.url,
      bypassSecret: values["vercel-bypass-secret"],
    });
    for (const receipt of receipts) {
      console.log(
        `Validated ${receipt.country} calibration release ${receipt.releaseId}`,
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Calibration qualification failed.",
    );
    process.exitCode = 1;
  }
}
