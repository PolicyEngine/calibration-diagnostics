import {
  BlobPreconditionFailedError,
  get,
  put,
  type GetBlobResult,
} from "@vercel/blob";

import {
  calibrationTreePartPath,
  type CalibrationTreePart,
} from "./calibration-tree-artifact";
import {
  calibrationTreeBundleFile,
  validateCalibrationTreeBundle,
  type CalibrationTreeBundle,
  type CalibrationTreeBundleFile,
} from "./calibration-tree-bundle";
import {
  CALIBRATION_TREE_MANIFEST_PATH,
  emptyCalibrationTreeManifest,
  parseCalibrationTreeManifest,
  serializeCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifest,
  type CalibrationTreeManifestEntry,
} from "./calibration-tree-manifest";
import type { MicrocosmCountry } from "./countries";

const IMMUTABLE_CACHE_SECONDS = 31_536_000;
const MANIFEST_CACHE_SECONDS = 60;

export interface CalibrationTreeBlobClient {
  get: typeof get;
  put: typeof put;
}

const DEFAULT_BLOB_CLIENT: CalibrationTreeBlobClient = { get, put };

function tokenOption(token?: string): { token: string } | Record<string, never> {
  return token ? { token } : {};
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) throw new Error("Blob response did not include a body.");
  return new Response(stream).text();
}

export interface StoredCalibrationTreeManifest {
  manifest: CalibrationTreeManifest;
  etag: string | null;
}

export async function readCalibrationTreeManifest(options: {
  token?: string;
  consistent?: boolean;
  client?: CalibrationTreeBlobClient;
} = {}): Promise<StoredCalibrationTreeManifest> {
  const result = await (options.client ?? DEFAULT_BLOB_CLIENT).get(
    CALIBRATION_TREE_MANIFEST_PATH,
    {
      access: "private",
      useCache: options.consistent === false,
      ...tokenOption(options.token),
    },
  );
  if (!result) {
    return { manifest: emptyCalibrationTreeManifest(), etag: null };
  }
  if (result.statusCode !== 200) {
    throw new Error(`Unexpected calibration tree manifest status ${result.statusCode}.`);
  }
  return {
    manifest: parseCalibrationTreeManifest(JSON.parse(await streamText(result.stream))),
    etag: result.blob.etag,
  };
}

export async function getCalibrationTreeBlob(options: {
  country: MicrocosmCountry;
  buildArtifactId: string;
  part: CalibrationTreePart;
  token?: string;
  consistent?: boolean;
  ifNoneMatch?: string;
  client?: CalibrationTreeBlobClient;
}): Promise<GetBlobResult | null> {
  return (options.client ?? DEFAULT_BLOB_CLIENT).get(
    calibrationTreePartPath(
      options.country,
      options.buildArtifactId,
      options.part,
    ),
    {
      access: "private",
      useCache: options.consistent === true ? false : true,
      ifNoneMatch: options.ifNoneMatch,
      ...tokenOption(options.token),
    },
  );
}

async function uploadCalibrationTreeFile(options: {
  file: CalibrationTreeBundleFile;
  country: MicrocosmCountry;
  buildArtifactId: string;
  token: string;
  client: CalibrationTreeBlobClient;
}): Promise<{ pathname: string; sha256: string; bytes: number; created: boolean }> {
  const { file, country, buildArtifactId, token, client } = options;
  const existing = await getCalibrationTreeBlob({
    country,
    buildArtifactId,
    part: file.part,
    token,
    consistent: true,
    client,
  });
  if (existing) {
    const existingText = await streamText(existing.stream);
    const verified = new TextEncoder().encode(existingText);
    const expected = new TextEncoder().encode(file.serialized);
    if (
      verified.length !== expected.length ||
      verified.some((byte, index) => byte !== expected[index])
    ) {
      throw new Error(
        `Immutable calibration tree part ${file.path} already exists with different content.`,
      );
    }
    return {
      pathname: file.path,
      sha256: file.sha256,
      bytes: file.rawBytes,
      created: false,
    };
  }

  await client.put(file.path, file.serialized, {
    access: "private",
    token,
    addRandomSuffix: false,
    multipart: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: IMMUTABLE_CACHE_SECONDS,
  });
  const uploaded = await getCalibrationTreeBlob({
    country,
    buildArtifactId,
    part: file.part,
    token,
    consistent: true,
    client,
  });
  if (!uploaded || await streamText(uploaded.stream) !== file.serialized) {
    throw new Error(`Uploaded calibration tree part ${file.path} failed verification.`);
  }
  return {
    pathname: file.path,
    sha256: file.sha256,
    bytes: file.rawBytes,
    created: true,
  };
}

export async function uploadCalibrationTreeBundle(options: {
  bundle: CalibrationTreeBundle;
  token: string;
  client?: CalibrationTreeBlobClient;
}): Promise<{
  files: Array<{ pathname: string; sha256: string; bytes: number; created: boolean }>;
  index: { pathname: string; sha256: string; bytes: number; created: boolean };
}> {
  const { bundle, token, client = DEFAULT_BLOB_CLIENT } = options;
  validateCalibrationTreeBundle(bundle);
  const uploaded = [];
  for (const file of bundle.files) {
    uploaded.push(await uploadCalibrationTreeFile({
      file,
      country: bundle.index.country,
      buildArtifactId: bundle.index.buildArtifactId,
      token,
      client,
    }));
  }
  return {
    files: uploaded,
    index: uploaded[bundle.files.indexOf(calibrationTreeBundleFile(bundle, "index"))],
  };
}

export async function updateCalibrationTreeManifest(options: {
  country: MicrocosmCountry;
  entry: CalibrationTreeManifestEntry;
  makeLatest?: boolean;
  token: string;
  retries?: number;
  client?: CalibrationTreeBlobClient;
}): Promise<CalibrationTreeManifest> {
  const retries = options.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const current = await readCalibrationTreeManifest({
      token: options.token,
      consistent: true,
      client: options.client,
    });
    const updated = withCalibrationTreeManifestEntry(
      current.manifest,
      options.country,
      options.entry,
      options.makeLatest,
    );
    const serialized = serializeCalibrationTreeManifest(updated);
    try {
      await (options.client ?? DEFAULT_BLOB_CLIENT).put(
        CALIBRATION_TREE_MANIFEST_PATH,
        serialized,
        {
          access: "private",
          token: options.token,
          addRandomSuffix: false,
          allowOverwrite: current.etag != null,
          ifMatch: current.etag ?? undefined,
          contentType: "application/json; charset=utf-8",
          cacheControlMaxAge: MANIFEST_CACHE_SECONDS,
        },
      );
      const verified = await readCalibrationTreeManifest({
        token: options.token,
        consistent: true,
        client: options.client,
      });
      const verifiedEntry = verified.manifest.countries[options.country]?.builds.find(
        (entry) => entry.buildArtifactId === options.entry.buildArtifactId,
      );
      if (
        !verifiedEntry ||
        verifiedEntry.buildArtifactId !== options.entry.buildArtifactId ||
        verifiedEntry.hfCommitSha !== options.entry.hfCommitSha ||
        verifiedEntry.indexSha256 !== options.entry.indexSha256
      ) {
        throw new Error("Calibration tree manifest verification failed.");
      }
      return verified.manifest;
    } catch (error) {
      lastError = error;
      if (current.etag && !(error instanceof BlobPreconditionFailedError)) throw error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Calibration tree manifest update failed after concurrent writes.");
}
