import {
  BlobPreconditionFailedError,
  del,
  get,
  list,
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
  type CalibrationTreeLatestManifestV2,
  type CalibrationTreeManifestEntry,
} from "./calibration-tree-manifest";
import type { MicrocosmCountry } from "./countries";

const IMMUTABLE_CACHE_SECONDS = 31_536_000;
const MANIFEST_CACHE_SECONDS = 60;
export const LEGACY_CALIBRATION_TREE_PREFIX = "calibration-trees/v1/";
export const LEGACY_CALIBRATION_TREE_MANIFEST_PATH =
  "calibration-trees/latest.v1.json";

export interface CalibrationTreeBlobClient {
  get: typeof get;
  put: typeof put;
  list?: typeof list;
  del?: typeof del;
}

const DEFAULT_BLOB_CLIENT: CalibrationTreeBlobClient = { get, put, list, del };

function tokenOption(token?: string): { token: string } | Record<string, never> {
  return token ? { token } : {};
}

async function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) throw new Error("Blob response did not include a body.");
  return new Response(stream).text();
}

export interface StoredCalibrationTreeManifest {
  manifest: CalibrationTreeLatestManifestV2;
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
  hfCommitSha: string;
  part: CalibrationTreePart;
  token?: string;
  consistent?: boolean;
  ifNoneMatch?: string;
  client?: CalibrationTreeBlobClient;
}): Promise<GetBlobResult | null> {
  return (options.client ?? DEFAULT_BLOB_CLIENT).get(
    calibrationTreePartPath(options.country, options.hfCommitSha, options.part),
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
  hfCommitSha: string;
  token: string;
  client: CalibrationTreeBlobClient;
}): Promise<{ pathname: string; sha256: string; bytes: number; created: boolean }> {
  const { file, country, hfCommitSha, token, client } = options;
  const existing = await getCalibrationTreeBlob({
    country,
    hfCommitSha,
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
    hfCommitSha,
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
      hfCommitSha: bundle.index.hfCommitSha,
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
  token: string;
  retries?: number;
  client?: CalibrationTreeBlobClient;
}): Promise<CalibrationTreeLatestManifestV2> {
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
      const verifiedEntry = verified.manifest.countries[options.country];
      if (
        !verifiedEntry ||
        verifiedEntry.releaseId !== options.entry.releaseId ||
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

export async function listLegacyCalibrationTreeBlobs(options: {
  token: string;
  client?: CalibrationTreeBlobClient;
}): Promise<string[]> {
  const client = options.client ?? DEFAULT_BLOB_CLIENT;
  if (!client.list) throw new Error("Blob client does not support listing objects.");
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.list({
      prefix: LEGACY_CALIBRATION_TREE_PREFIX,
      cursor,
      limit: 1000,
      ...tokenOption(options.token),
    });
    paths.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const oldManifest = await client.get(LEGACY_CALIBRATION_TREE_MANIFEST_PATH, {
    access: "private",
    useCache: false,
    ...tokenOption(options.token),
  });
  if (oldManifest) paths.push(LEGACY_CALIBRATION_TREE_MANIFEST_PATH);
  return [...new Set(paths)].sort();
}

export async function deleteLegacyCalibrationTreeBlobs(options: {
  token: string;
  paths: string[];
  client?: CalibrationTreeBlobClient;
}): Promise<void> {
  const client = options.client ?? DEFAULT_BLOB_CLIENT;
  if (!client.del) throw new Error("Blob client does not support deleting objects.");
  if (
    options.paths.some(
      (path) =>
        path !== LEGACY_CALIBRATION_TREE_MANIFEST_PATH &&
        !path.startsWith(LEGACY_CALIBRATION_TREE_PREFIX),
    )
  ) {
    throw new Error("Refusing to delete a Blob outside the obsolete calibration-tree paths.");
  }
  if (options.paths.length) {
    await client.del(options.paths, { token: options.token });
  }
}
