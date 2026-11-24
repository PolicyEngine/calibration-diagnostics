// The collector's calibration tree store, which the release and staging
// calibration views read instead of Hugging Face. The collector keeps there,
// beside each build's tree:
//
// - a copy of each build's original files, by build ID
//   (`calibration-tree-sources/<country>/<build ID>/`);
// - a copy of each country's `releases.json`;
// - copies of the files of every run in the country's staging repository
//   (`staging-run-files/<country>/`).
//
// The readers here give the answers the package's Hugging Face readers give
// for the same files: they read the copies and pass them to the same package
// functions. Nothing here reads Hugging Face. A copy the store does not hold
// is reported as missing; it is never fetched from Hugging Face instead.
import { get } from "@vercel/blob";

import {
  calibrationReleaseFromManifest,
  requestedReleaseId,
  type CalibrationReleaseLocation,
} from "@policyengine/calibration-tree/calibration-release-locator";
import type { CalibrationTreeBlobClient } from "@policyengine/calibration-tree/calibration-tree-blob";
import { readCalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-blob";
import {
  releaseDirectoryOf,
  type CalibrationTreeManifest,
} from "@policyengine/calibration-tree/calibration-tree-manifest";
import { readStoredReleasesRecord } from "@policyengine/calibration-tree/calibration-tree-releases-record";
import {
  CALIBRATION_TREE_SOURCE_FILE_NAMES,
  readCalibrationTreeSourceJson,
  type CalibrationTreeSourceFile,
} from "@policyengine/calibration-tree/calibration-tree-source-files";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import {
  buildCalibration,
  calibrationAsReleased,
  InvalidReleaseIdError,
  loadPointerReleaseId,
  loadRelease,
  loadReleases,
  releaseRole,
  UK_LOCAL_CALIBRATION_DIR_ENV,
  type Calibration,
  type ReleaseEntry,
} from "@policyengine/calibration-tree/latest-artifact";
import { parseReleaseCutTag } from "@policyengine/calibration-tree/release-cut";
import {
  isBuildFolderId,
  isReleaseDirectory,
  type ReleasesRecord,
} from "@policyengine/calibration-tree/release-record";

type JsonObject = Record<string, unknown>;

/**
 * The one Blob client the store readers use. Reads pass no token, so they use
 * the deployment's own Blob credentials, as the tree manifest's reads do.
 * Tests replace `get`.
 */
export const collectorStoreBlob = {
  get: ((...args: Parameters<typeof get>) => get(...args)) as typeof get,
};

// The package's manifest reader takes a whole client; it only reads.
const manifestClient: CalibrationTreeBlobClient = {
  get: (...args) => collectorStoreBlob.get(...args),
  put: () => {
    throw new Error("The dashboard never writes the calibration tree manifest.");
  },
};

/** A copy the collector's store does not hold. */
export class StoredCopyMissingError extends Error {}

/** The tree manifest, read as the package reads it, through the store client. */
export async function readStoreManifest(): Promise<{ manifest: CalibrationTreeManifest }> {
  return readCalibrationTreeManifest({ client: manifestClient });
}

/** A build's copy of one original file, as the package's Hugging Face reader parses it; null without one. */
export function readBuildCopy(
  country: MicrocosmCountry,
  buildArtifactId: string,
  file: CalibrationTreeSourceFile,
) {
  return readCalibrationTreeSourceJson({
    country,
    buildArtifactId,
    file,
    client: collectorStoreBlob,
  });
}

function copyMissing(
  country: MicrocosmCountry,
  buildArtifactId: string,
  file: CalibrationTreeSourceFile,
): StoredCopyMissingError {
  return new StoredCopyMissingError(
    `The collector's store holds no copy of ${CALIBRATION_TREE_SOURCE_FILE_NAMES[file]} ` +
      `for ${country} build ${buildArtifactId}.`,
  );
}

// An optional file, read as the Hugging Face reader read it: absent, or
// unreadable, is an empty object.
async function optionalCopy(
  country: MicrocosmCountry,
  buildArtifactId: string,
  file: CalibrationTreeSourceFile,
): Promise<JsonObject> {
  try {
    return (await readBuildCopy(country, buildArtifactId, file))?.payload ?? {};
  } catch {
    return {};
  }
}

// --- the local UK calibration folder ------------------------------------
// A developer can point MICROCOSM_UK_LOCAL_CALIBRATION_DIR at a build's files.
// The package reads that folder itself, with no request, so the readers below
// hand such requests to it.

function readsLocalCalibration(country: MicrocosmCountry): boolean {
  return country === "uk" && Boolean(process.env[UK_LOCAL_CALIBRATION_DIR_ENV]?.trim());
}

// --- release builds ------------------------------------------------------

/** Where a release build's files are, from the tree manifest. */
export async function resolveStoredRelease(
  country: MicrocosmCountry,
  requestedRelease: string,
): Promise<CalibrationReleaseLocation> {
  const releaseId = requestedReleaseId(requestedRelease);
  const { manifest } = await readStoreManifest();
  return calibrationReleaseFromManifest(manifest, country, releaseId);
}

/** The release the tree manifest marks latest, as `loadPointerReleaseId` gives it. */
export async function loadStoredPointerReleaseId(
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<{ release_id: string; updated_at: string | null }> {
  if (readsLocalCalibration(country)) return loadPointerReleaseId(revalidate, country);
  const location = await resolveStoredRelease(country, "latest");
  return { release_id: location.releaseId, updated_at: location.updatedAt };
}

interface ReleaseCacheEntry {
  promise: Promise<Calibration>;
  expiresAt: number;
}

const releaseCache = new Map<string, ReleaseCacheEntry>();
const RELEASE_CACHE_LIMIT = 8;

async function loadStoredReleaseUncached(
  releaseId: string,
  country: MicrocosmCountry,
): Promise<Calibration> {
  const location = await resolveStoredRelease(country, releaseId || "latest");
  const id = location.releaseId;
  const directory = location.releaseDirectory;
  if (!isReleaseDirectory(directory) || directory === "latest") {
    throw new InvalidReleaseIdError("Invalid release directory id");
  }
  const build = location.buildArtifactId;
  const [diagnostics, buildManifest, releaseManifest, demographics] = await Promise.all([
    readBuildCopy(country, build, "calibrationDiagnostics"),
    optionalCopy(country, build, "buildManifest"),
    optionalCopy(country, build, "releaseManifest"),
    optionalCopy(country, build, "demographics"),
  ]);
  if (!diagnostics) throw copyMissing(country, build, "calibrationDiagnostics");
  const calibration = buildCalibration(
    diagnostics.payload,
    id,
    // Null only for an entry written before publication times were recorded.
    location.updatedAt,
    buildManifest,
    releaseManifest,
    demographics,
    country,
    "huggingface_immutable",
    diagnostics.sha256,
    location.hfCommitSha,
  );
  return calibrationAsReleased(calibration, id, directory);
}

/**
 * One release build's calibration, as the package's `loadRelease` builds it,
 * from the store's copies of its original files. "latest" is the build the
 * tree manifest marks latest. Answers are cached as `loadRelease` caches them.
 */
export async function loadStoredRelease(
  releaseId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<Calibration> {
  const requestedRelease = releaseId || "latest";
  if (readsLocalCalibration(country)) {
    // The folder serves "latest" and its own build; other releases come from
    // the store.
    const local = await loadRelease("latest", revalidate, country);
    if (requestedRelease === "latest" || requestedRelease === local.release_id) return local;
  }
  const cacheSeconds = requestedRelease === "latest"
    ? Math.min(Math.max(revalidate, 1), 60)
    : Math.max(revalidate, 1);
  const cacheKey = `${country}:${requestedRelease}:${cacheSeconds}`;
  const now = Date.now();
  for (const [key, entry] of releaseCache) {
    if (entry.expiresAt <= now) releaseCache.delete(key);
  }
  const cached = releaseCache.get(cacheKey);
  if (cached) return cached.promise;
  const promise = loadStoredReleaseUncached(requestedRelease, country);
  releaseCache.set(cacheKey, { promise, expiresAt: now + cacheSeconds * 1000 });
  while (releaseCache.size > RELEASE_CACHE_LIMIT) {
    const oldest = releaseCache.keys().next().value;
    if (typeof oldest !== "string") break;
    releaseCache.delete(oldest);
  }
  try {
    return await promise;
  } catch (error) {
    if (releaseCache.get(cacheKey)?.promise === promise) releaseCache.delete(cacheKey);
    throw error;
  }
}

/** A release build's stored `parent_build_manifest.json`; null when the build has none. */
export async function loadStoredParentBuildManifest(
  location: CalibrationReleaseLocation,
  country: MicrocosmCountry,
): Promise<JsonObject | null> {
  return (await readBuildCopy(country, location.buildArtifactId, "parentBuildManifest"))
    ?.payload ?? null;
}

// --- the release inventory ----------------------------------------------

/**
 * The country's `releases.json` from the store's copy: null when the copy
 * says the repository has none. A country the collector has stored no copy
 * for yet fails, as an unreadable `releases.json` fails the Hugging Face
 * reader: it is never taken for a repository without one.
 */
export async function loadStoredReleasesRecord(
  _revalidate: number,
  country: MicrocosmCountry,
): Promise<ReleasesRecord | null> {
  if (readsLocalCalibration(country)) return null;
  const stored = await readStoredReleasesRecord({ country, client: collectorStoreBlob });
  if (stored.state === "record") return stored.record;
  if (stored.state === "no_record") return null;
  throw new StoredCopyMissingError(
    `The collector's store holds no copy of ${country}'s releases.json yet.`,
  );
}

// As the package's release listing dates and orders a release id: by the
// trailing YYYYMMDD[THHMMSSZ] it ends in.
function releaseDate(id: string): string {
  const match = /(\d{8}(?:T\d{6}Z)?)$/.exec(id);
  return match ? match[1] : id;
}

function releaseSortKey(id: string): number {
  const match = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(id);
  if (!match) return 0;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
}

// The release builds of a repository without releases.json, as the tree
// manifest lists them. A build in its own folder (`<release>/<build>`) is
// listed only from releases.json, as before.
function manifestReleaseBuilds(manifest: CalibrationTreeManifest, country: MicrocosmCountry) {
  return (manifest.countries[country]?.builds ?? []).filter(
    (build) => build.kind === "release" && build.releaseId != null && !isBuildFolderId(build.releaseId),
  );
}

// A release build as the picker lists it, classified from its stored
// release manifest. A missing or unreadable manifest keeps the default
// classification, as the Hugging Face listing's best-effort read did.
async function manifestReleaseEntry(
  country: MicrocosmCountry,
  build: ReturnType<typeof manifestReleaseBuilds>[number],
  date: string,
): Promise<ReleaseEntry> {
  const releaseId = build.releaseId as string;
  const directory = releaseDirectoryOf(build) ?? releaseId;
  const entry: ReleaseEntry = {
    release_id: releaseId,
    date,
    files: [],
    has_calibration: true,
    dataset_role: null,
    is_default: true,
    is_local_area: false,
    ...(directory !== releaseId ? { release_directory: directory } : {}),
  };
  try {
    const manifestCopy = await readBuildCopy(country, build.buildArtifactId, "releaseManifest");
    if (manifestCopy) Object.assign(entry, releaseRole(manifestCopy.payload));
  } catch {
    // Best-effort: keep the default classification.
  }
  return entry;
}

/**
 * In place of the `releases/` folder listing of a repository without
 * releases.json: each release build the tree manifest holds in its own
 * release folder, newest first. Folders without calibration diagnostics have
 * no build in the manifest, so they are not listed.
 */
export async function loadStoredReleaseFolders(
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<ReleaseEntry[]> {
  if (readsLocalCalibration(country)) return loadReleases(revalidate, country);
  const { manifest } = await readStoreManifest();
  const folders = manifestReleaseBuilds(manifest, country).filter(
    (build) => releaseDirectoryOf(build) === build.releaseId,
  );
  const entries = await Promise.all(
    folders.map((build) => manifestReleaseEntry(country, build, releaseDate(build.releaseId!))),
  );
  return entries.sort(
    (left, right) => releaseSortKey(right.release_id) - releaseSortKey(left.release_id),
  );
}

/**
 * In place of `loadPublishedCutReleases`: the published release builds the
 * folder listing above does not name, which are those read from another
 * release's folder (a tag of a release series). Roles come from each build's
 * stored release manifest.
 */
export async function loadStoredTaggedReleases(
  _revalidate: number,
  country: MicrocosmCountry,
  manifest: CalibrationTreeManifest,
  folders: readonly ReleaseEntry[],
): Promise<ReleaseEntry[]> {
  if (readsLocalCalibration(country)) return [];
  const calibratedFolders = new Set(
    folders.filter((folder) => folder.has_calibration).map((folder) => folder.release_id),
  );
  const tagged = manifestReleaseBuilds(manifest, country).filter(
    (build) =>
      releaseDirectoryOf(build) !== build.releaseId || !calibratedFolders.has(build.releaseId!),
  );
  return Promise.all(
    tagged.map((build) =>
      manifestReleaseEntry(
        country,
        build,
        parseReleaseCutTag(build.releaseId!)?.cutAt ?? releaseDate(build.releaseId!),
      ),
    ),
  );
}

/** The tree manifest entry of a staging run's tree; null when the run has none. */
export function stagingTreeEntry(
  manifest: CalibrationTreeManifest,
  country: MicrocosmCountry,
  runId: string,
) {
  return (
    manifest.countries[country]?.builds.find(
      (build) => build.kind === "staging" && build.stagingRunId === runId,
    ) ?? null
  );
}
