import { readFile } from "node:fs/promises";
import path from "node:path";

import { ArtifactError, CrossDatasetArtifactReader } from "./artifact";
import {
  DEFAULT_COUNTRY,
  countryRegistration,
  type MicrocosmCountry,
} from "../microcosm/countries";

interface CountryArtifactConfig {
  countryCode: string;
  directoryEnv: string;
  baseUrlEnv: string;
  expectedRunIdEnv: string;
  jurisdictionAliases: readonly string[];
}

interface CachedReader {
  key: string;
  reader: CrossDatasetArtifactReader;
}

const cachedReaders = new Map<MicrocosmCountry, CachedReader>();

// The unsuffixed variables remain the default country's configuration so
// existing deployments keep working; every other country uses its code as a
// suffix.
function countryArtifactConfig(country: MicrocosmCountry): CountryArtifactConfig {
  const countryCode = country.toUpperCase();
  const suffix = country === DEFAULT_COUNTRY ? "" : `_${countryCode}`;
  return {
    countryCode,
    directoryEnv: `CROSS_DATASET_ARTIFACT_DIR${suffix}`,
    baseUrlEnv: `CROSS_DATASET_ARTIFACT_BASE_URL${suffix}`,
    expectedRunIdEnv: `CROSS_DATASET_EXPECTED_RUN_ID${suffix}`,
    jurisdictionAliases: countryRegistration(country).jurisdiction_aliases ?? [],
  };
}

function directoryReader(
  directory: string,
  expectedRunId: string | undefined,
  config: CountryArtifactConfig,
) {
  const root = path.resolve(directory);
  return new CrossDatasetArtifactReader({
    expectedRunId,
    expectedJurisdiction: config.countryCode,
    jurisdictionAliases: config.jurisdictionAliases,
    readText: async (relativePath) => {
      const resolved = path.resolve(root, relativePath);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new ArtifactError("malformed_artifact", "Artifact partition escaped its configured root.");
      }
      return readFile(resolved, "utf8");
    },
  });
}

function remoteReader(
  baseUrl: string,
  expectedRunId: string | undefined,
  config: CountryArtifactConfig,
) {
  let base: URL;
  try {
    base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch (error) {
    throw new ArtifactError(
      "malformed_artifact",
      `${config.baseUrlEnv} must be a valid HTTP(S) URL.`,
      { cause: error },
    );
  }
  if (!/^https?:$/.test(base.protocol)) {
    throw new ArtifactError(
      "malformed_artifact",
      `${config.baseUrlEnv} must use HTTP(S).`,
    );
  }
  return new CrossDatasetArtifactReader({
    expectedRunId,
    expectedJurisdiction: config.countryCode,
    jurisdictionAliases: config.jurisdictionAliases,
    readText: async (relativePath) => {
      const url = new URL(relativePath, base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
        throw new ArtifactError("malformed_artifact", "Artifact partition escaped its configured URL.");
      }
      const response = await fetch(url, { next: { revalidate: 300 } });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      return response.text();
    },
  });
}

export function configuredCrossDatasetReader(
  country: MicrocosmCountry,
): CrossDatasetArtifactReader {
  const config = countryArtifactConfig(country);
  const directory = process.env[config.directoryEnv]?.trim() || "";
  const baseUrl = process.env[config.baseUrlEnv]?.trim() || "";
  const expectedRunId = process.env[config.expectedRunIdEnv]?.trim() || undefined;
  if (directory && baseUrl) {
    throw new ArtifactError(
      "malformed_artifact",
      `Configure only one of ${config.directoryEnv} and ${config.baseUrlEnv} for ${config.countryCode}.`,
    );
  }
  if (!directory && !baseUrl) {
    throw new ArtifactError(
      "partial_artifact",
      `Cross-dataset artifacts are not configured for ${config.countryCode}. Set ${config.directoryEnv} or ${config.baseUrlEnv}.`,
    );
  }
  const key = `${directory}\0${baseUrl}\0${expectedRunId ?? ""}`;
  const cached = cachedReaders.get(country);
  if (cached?.key === key) return cached.reader;
  const reader = directory
    ? directoryReader(directory, expectedRunId, config)
    : remoteReader(baseUrl, expectedRunId, config);
  cachedReaders.set(country, { key, reader });
  return reader;
}
