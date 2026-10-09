import { parseArgs } from "node:util";

import {
  hasCapability,
  selectableCountries,
  type MicrocosmCountry,
} from "../lib/microcosm/countries";

type JsonObject = Record<string, unknown>;
type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;

interface CalibrationDeploymentOptions {
  // The mounted dashboard root, e.g. https://candidate.vercel.app/calibration/dashboard.
  url: string;
  bypassSecret?: string;
  fetcher?: Fetcher;
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
  const response = await fetcher(url, {
    headers: options.bypassSecret
      ? { "x-vercel-protection-bypass": options.bypassSecret }
      : {},
    cache: "no-store",
    // Never forward a preview's bypass credential to a redirect destination.
    redirect: "error",
    signal: AbortSignal.timeout(300_000),
  });
  if (response.status !== 200) {
    throw new Error(`${country} ${label} returned HTTP ${response.status}.`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`${country} ${label} did not return JSON.`);
  }
  return record(await response.json(), `${country} ${label}`);
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
