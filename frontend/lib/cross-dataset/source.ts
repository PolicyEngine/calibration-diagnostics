import { readFile } from "node:fs/promises";
import path from "node:path";

import { ArtifactError, CrossDatasetArtifactReader } from "./artifact";

let cachedKey = "";
let cachedReader: CrossDatasetArtifactReader | null = null;

function directoryReader(directory: string, expectedRunId?: string) {
  const root = path.resolve(directory);
  return new CrossDatasetArtifactReader({
    expectedRunId,
    readText: async (relativePath) => {
      const resolved = path.resolve(root, relativePath);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new ArtifactError("malformed_artifact", "Artifact partition escaped its configured root.");
      }
      return readFile(resolved, "utf8");
    },
  });
}

function remoteReader(baseUrl: string, expectedRunId?: string) {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (!/^https?:$/.test(base.protocol)) {
    throw new ArtifactError("malformed_artifact", "CROSS_DATASET_ARTIFACT_BASE_URL must use HTTP(S).");
  }
  return new CrossDatasetArtifactReader({
    expectedRunId,
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

export function configuredCrossDatasetReader(): CrossDatasetArtifactReader {
  const directory = process.env.CROSS_DATASET_ARTIFACT_DIR?.trim() || "";
  const baseUrl = process.env.CROSS_DATASET_ARTIFACT_BASE_URL?.trim() || "";
  const expectedRunId = process.env.CROSS_DATASET_EXPECTED_RUN_ID?.trim() || undefined;
  if (directory && baseUrl) {
    throw new ArtifactError(
      "malformed_artifact",
      "Configure only one of CROSS_DATASET_ARTIFACT_DIR and CROSS_DATASET_ARTIFACT_BASE_URL.",
    );
  }
  if (!directory && !baseUrl) {
    throw new ArtifactError(
      "partial_artifact",
      "Cross-dataset artifacts are not configured. Set CROSS_DATASET_ARTIFACT_DIR or CROSS_DATASET_ARTIFACT_BASE_URL.",
    );
  }
  const key = `${directory}\0${baseUrl}\0${expectedRunId ?? ""}`;
  if (cachedReader && cachedKey === key) return cachedReader;
  cachedReader = directory
    ? directoryReader(directory, expectedRunId)
    : remoteReader(baseUrl, expectedRunId);
  cachedKey = key;
  return cachedReader;
}
