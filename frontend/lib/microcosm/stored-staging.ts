// The Staging page's readers over the collector's store: the copies of each
// staging run's files (`staging-run-files/<country>/`) and, for a run with
// calibration diagnostics, its stored tree's copies of the original files.
// Each gives the answer the package's Hugging Face reader of the same name
// gives for the same files (`loadStagingRuns`, `loadStagingRun`,
// `loadStagingCalibration` and the rest), and none reads Hugging Face. The
// copies hold what a run's files said when the collector last copied them;
// an unfinished run's current state comes from the collector's telemetry
// when a page is requested (`staging-run-state.ts`).
import { getCalibrationTreeBlob } from "@policyengine/calibration-tree/calibration-tree-blob";
import { buildTargetChangeDatasetFromSummaryAndCalibration } from "@policyengine/calibration-tree/calibration-build-comparison";
import { loadCalibrationComparisonSource } from "@policyengine/calibration-tree/calibration-comparison-blob";
import type { CalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-manifest";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import {
  assertSafeReleaseId,
  assertSafeReleaseOrBuildFolderId,
  buildCalibration,
  buildComparison,
  latestMicrocosmCalibrationSummary,
  latestMicrocosmTargetDiagnosticsPage,
  microcosmCountryGeography,
  microcosmRepo,
  recordedReleaseInventory,
  type Calibration,
  type ReleaseEntry,
} from "@policyengine/calibration-tree/latest-artifact";
import { buildReformValidation } from "@policyengine/calibration-tree/reforms";
import {
  newestPublishedLocalAreaRelease,
  resolveStagingComparisonRelease,
  sortRuns,
  stagedBundleDiagnosticsFile,
  stagingRepository,
  stagingTargetChangeCacheTtlSeconds,
  stagingUnavailableReason,
  type IncompatibleStagingRun,
  type StagingComparisonRelease,
  type StagingRunDetail,
  type StagingRunSummary,
} from "@policyengine/calibration-tree/staging-artifact";
import {
  isStructuredStagingDocument,
  parseStagingCalibrationProgress,
  parseStagingEvents,
  parseStagingManifest,
  parseStagingProgress,
  validateStagingRunConsistency,
} from "@policyengine/calibration-tree/staging-contract";
import {
  readStagingRunFile,
  readStagingRunFilesIndex,
  stagingJsonObjectOrNull,
  type StagingRunFileName,
  type StagingRunFileRecord,
  type StagingRunFilesIndex,
  type StagingRunRecord,
} from "@policyengine/calibration-tree/staging-run-files";
import { buildTargetChangeDataset } from "@policyengine/calibration-tree/target-change";

import {
  collectorStoreBlob,
  loadStoredPointerReleaseId,
  loadStoredRelease,
  loadStoredReleaseFolders,
  loadStoredTaggedReleases,
  loadStoredReleasesRecord,
  readBuildCopy,
  readStoreManifest,
  stagingTreeEntry,
  StoredCopyMissingError,
} from "@/lib/microcosm/collector-store";

type JsonObject = Record<string, unknown>;

const TARGET_CHANGE_FINAL_CACHE_SECONDS = 21_600;
const CACHE_LIMIT = 8;
// A staging tree's copies never change under its build ID, so a calibration
// built from them is reused while the run's documents name the same build.
const STAGING_CALIBRATION_CACHE_SECONDS = 300;
const NOT_UPLOADED = "This staging run has not uploaded calibration_diagnostics.json yet.";
// A staged bundle's receipt states that list it as landed, as the Hugging
// Face reader takes them.
const STAGED_BUNDLE_LANDED = new Set(["uploaded", "already_staged"]);
const SHA_256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function objectOrNull(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function schemaVersionValue(value: unknown): StagingRunDetail["schema_version"] {
  return typeof value === "number" && Number.isInteger(value)
    ? (value as StagingRunDetail["schema_version"])
    : null;
}

function unavailableStaging(country: MicrocosmCountry) {
  const detail = stagingUnavailableReason(country);
  if (!detail) return null;
  return { available: false as const, source_repo: null, revision: null, detail };
}

// The country's staging repository as the registry names it, which the
// pages link to. Reading it makes no request.
function configuredRepository(country: MicrocosmCountry) {
  const repository = stagingRepository(country);
  if (!repository) throw new Error(stagingUnavailableReason(country) ?? "No staging repository.");
  return repository;
}

// --- a run's copied documents --------------------------------------------

export interface CopiedRunDocuments {
  record: StagingRunRecord;
  progress: JsonObject | null;
  runManifest: JsonObject | null;
  calibrationProgress: JsonObject | null;
  events: JsonObject[];
  reformValidation: JsonObject | null;
  /** The staged bundle's receipt, as the run copied it. */
  stagedDatasetReceipt: JsonObject | null;
}

// Where a version 2 or 3 run's reform validation is copied: under the path in
// the run folder its run manifest declares for the artifact. Version 1 runs
// write `reform_validation.json` at the folder's top level.
const REFORM_VALIDATION_ARTIFACT = "reform_validation";

function declaredArtifactPath<Name extends string>(logicalName: Name) {
  return `artifacts/${logicalName}.json` as const;
}

const DECLARED_REFORM_VALIDATION = declaredArtifactPath(REFORM_VALIDATION_ARTIFACT);

type CopiedFileName = StagingRunFileName | typeof DECLARED_REFORM_VALIDATION;

function copiedFile(record: StagingRunRecord, name: CopiedFileName) {
  return (record.files as Partial<Record<CopiedFileName, StagingRunFileRecord>>)[name];
}

async function readCopiedJson(record: StagingRunRecord, name: CopiedFileName) {
  const file = copiedFile(record, name);
  return file
    ? readStagingRunFile({ record: file, client: collectorStoreBlob })
    : null;
}

/** The country's index of copied runs; null when the store holds none yet. */
async function copiedRunIndex(country: MicrocosmCountry): Promise<StagingRunFilesIndex | null> {
  const { index, etag } = await readStagingRunFilesIndex({ country, client: collectorStoreBlob });
  // The package answers an index the store doesn't hold with an empty one.
  return etag === null ? null : index;
}

function noCopiesDetail(country: MicrocosmCountry): string {
  return `The collector's store holds no copy of ${microcosmCountryGeography(country)}'s staging runs yet.`;
}

/** The country's copied runs by run ID, without removed ones; empty when the store holds no copies. */
async function copiedRunRecords(country: MicrocosmCountry): Promise<Map<string, StagingRunRecord>> {
  const index = await copiedRunIndex(country);
  return new Map(
    Object.values(index?.runs ?? {})
      .filter((record) => !record.removedAt)
      .map((record) => [record.runId, record]),
  );
}

// `reform_validation.json` stands for the run's reform validation, wherever
// the run's version keeps it.
const ALL_DOCUMENTS: readonly StagingRunFileName[] = [
  "progress.json",
  "run_manifest.json",
  "calibration_progress.json",
  "events.ndjson",
  "reform_validation.json",
  "artifacts/staged_dataset.json",
];

// What a run's calibration needs: its identity and how its diagnostics were
// declared.
const CALIBRATION_DOCUMENTS: readonly StagingRunFileName[] = [
  "progress.json",
  "run_manifest.json",
  "artifacts/staged_dataset.json",
];

/**
 * One run's copied documents, parsed and checked as the Hugging Face reader
 * parses and checks them. `names` limits what is read; the rest is absent.
 * A version 2 or 3 run's reform validation is the copy its run manifest
 * declares under `artifacts/`, which the package's 0.1.5 Hugging Face reader
 * does not read.
 */
export async function copiedRunDocuments(
  record: StagingRunRecord,
  names: readonly StagingRunFileName[] = ALL_DOCUMENTS,
): Promise<CopiedRunDocuments> {
  const wanted = new Set(names);
  // A version 2 or 3 run's copied documents say so in the index's summary,
  // so its reform validation is read from where version 2 writes it.
  const structured = (record.summary.schema_version ?? 1) >= 2;
  const reformValidationName: CopiedFileName = structured
    ? DECLARED_REFORM_VALIDATION
    : "reform_validation.json";
  const read = (name: StagingRunFileName) =>
    wanted.has(name)
      ? readCopiedJson(record, name === "reform_validation.json" ? reformValidationName : name)
      : Promise.resolve(null);
  const [progressBytes, manifestBytes, calibrationBytes, eventBytes, reformBytes, receiptBytes] =
    await Promise.all(ALL_DOCUMENTS.map(read));
  const progressDocument = stagingJsonObjectOrNull(progressBytes);
  const manifestDocument = stagingJsonObjectOrNull(manifestBytes);
  const calibrationDocument = stagingJsonObjectOrNull(calibrationBytes);
  const progress = progressDocument && parseStagingProgress(progressDocument);
  const runManifest = manifestDocument && parseStagingManifest(manifestDocument);
  const calibrationProgress =
    calibrationDocument && parseStagingCalibrationProgress(calibrationDocument);
  const events = parseStagingEvents(eventBytes && new TextDecoder().decode(eventBytes));
  validateStagingRunConsistency(record.runId, {
    progress,
    runManifest,
    calibrationProgress,
    events,
  });
  return {
    record,
    progress,
    runManifest,
    calibrationProgress,
    events,
    reformValidation:
      !structured ||
      declaresCopy(runManifest, REFORM_VALIDATION_ARTIFACT, copiedFile(record, reformValidationName))
        ? stagingJsonObjectOrNull(reformBytes)
        : null,
    stagedDatasetReceipt: stagingJsonObjectOrNull(receiptBytes),
  };
}

/**
 * Whether a structured run manifest declares the artifact `logicalName` with
 * the digest of the copy: a version 2 run shows only the result files its
 * run manifest declares, as they were when it declared them.
 */
function declaresCopy(
  runManifest: JsonObject | null,
  logicalName: string,
  copy: StagingRunFileRecord | undefined,
): boolean {
  if (!copy || !isStructuredStagingDocument(runManifest)) return false;
  const artifact = objectOrNull(objectOrNull(runManifest?.artifacts)?.[logicalName]);
  return (
    stringValue(artifact?.path) === declaredArtifactPath(logicalName) &&
    stringValue(artifact?.sha256) === copy.sha256
  );
}

async function readRunDocuments(
  country: MicrocosmCountry,
  runId: string,
  names?: readonly StagingRunFileName[],
): Promise<CopiedRunDocuments | null> {
  const record = (await copiedRunRecords(country)).get(runId);
  return record ? copiedRunDocuments(record, names) : null;
}

function candidateReleaseIdOf(
  runId: string,
  progress: JsonObject | null,
  runManifest: JsonObject | null,
): string {
  return (
    stringValue(progress?.candidate_release_id) ??
    stringValue(runManifest?.candidate_release_id) ??
    runId
  );
}

// --- the run list --------------------------------------------------------

/**
 * The Candidate tab's run list, as `loadStagingRuns` gives it, from the
 * copies, listed as the package's `loadCopiedStagingRuns` lists them. A
 * country the collector has copied no runs for yet is unavailable, so a
 * missing copy never reads as a repository without runs.
 */
export async function loadStoredStagingRuns(_revalidate: number, country: MicrocosmCountry = "us") {
  const unavailable = unavailableStaging(country);
  if (unavailable) {
    return {
      ...unavailable,
      truncated: false,
      runs: [] as StagingRunSummary[],
      incompatible_runs: [] as IncompatibleStagingRun[],
    };
  }
  const repository = configuredRepository(country);
  const index = await copiedRunIndex(country);
  if (!index) {
    return {
      available: false as const,
      source_repo: repository.repo,
      revision: repository.revision,
      detail: noCopiesDetail(country),
      truncated: false,
      runs: [] as StagingRunSummary[],
      incompatible_runs: [] as IncompatibleStagingRun[],
    };
  }
  const records = Object.values(index.runs).filter((record) => !record.removedAt);
  return {
    available: true as const,
    source_repo: repository.repo,
    revision: repository.revision,
    truncated: false,
    runs: records
      .filter((record) => record.problem === null)
      .map((record) => record.summary)
      .sort(sortRuns),
    incompatible_runs: records.flatMap((record): IncompatibleStagingRun[] =>
      record.problem === null
        ? []
        : [{
          run_id: record.runId,
          run_manifest_path: `runs/${record.runId}/run_manifest.json`,
          detail: record.problem,
        }]
    ),
  };
}

// --- a run's calibration -------------------------------------------------

interface CalibrationCacheEntry {
  promise: Promise<Calibration | null>;
  expiresAt: number;
}

const calibrationCache = new Map<string, CalibrationCacheEntry>();

function remember<T>(
  cache: Map<string, { promise: Promise<T>; expiresAt: number }>,
  key: string,
  seconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cachedKey);
  }
  const cached = cache.get(key);
  if (cached) return cached.promise;
  const promise = load();
  cache.set(key, { promise, expiresAt: now + seconds * 1000 });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

interface StagingTreeSource {
  entry: NonNullable<ReturnType<typeof stagingTreeEntry>>;
  /** The diagnostics are the run's telemetry upload, not its staged bundle's. */
  fromRunFolder: boolean;
  /** The SHA-256 the run's files declare for the diagnostics; null when they declare none. */
  declaredSha256: string | null;
}

/**
 * The run's stored tree and how the run's copied files declare its
 * diagnostics, decided as the Hugging Face reader decided which file to read:
 * a schema 1 run, or one whose run manifest declares telemetry diagnostics,
 * from its run folder; any other from its staged bundle, through the receipt
 * the run manifest declares. Null when the run has no current copy, no tree,
 * or no diagnostics the old reader would have read: a receipt that is absent,
 * differs from its declaration, names another run or lists no landed bundle
 * with diagnostics.
 */
function stagingTreeSource(
  documents: CopiedRunDocuments | null,
  manifest: CalibrationTreeManifest,
  country: MicrocosmCountry,
  runId: string,
): StagingTreeSource | null {
  const entry = stagingTreeEntry(manifest, country, runId);
  if (!documents || !entry) return null;
  const runManifest = documents.runManifest;
  if (!isStructuredStagingDocument(runManifest)) {
    return { entry, fromRunFolder: true, declaredSha256: null };
  }
  const artifacts = objectOrNull(runManifest?.artifacts);
  const diagnosticsArtifact = objectOrNull(artifacts?.calibration_diagnostics);
  if (stringValue(diagnosticsArtifact?.staging_path) != null) {
    // A structured run manifest always declares its artifacts' digests.
    return { entry, fromRunFolder: true, declaredSha256: stringValue(diagnosticsArtifact?.sha256) ?? "" };
  }
  const stagedArtifact = objectOrNull(artifacts?.staged_dataset);
  const receipt = documents.stagedDatasetReceipt;
  const receiptCopy = documents.record.files["artifacts/staged_dataset.json"];
  if (
    !stringValue(stagedArtifact?.staging_path) ||
    !receipt ||
    receiptCopy?.sha256 !== stringValue(stagedArtifact?.sha256) ||
    !STAGED_BUNDLE_LANDED.has(String(receipt.status)) ||
    stringValue(receipt.run_id) !== runId ||
    // Where the old reader read the bundle: the country's registered release
    // repository, under staged/<run ID>, at a commit.
    stringValue(receipt.repository) !== microcosmRepo(country) ||
    stringValue(receipt.prefix) !== `staged/${runId}` ||
    !GIT_COMMIT.test(stringValue(receipt.revision) ?? "")
  ) {
    return null;
  }
  const files = objectOrNull(receipt.files);
  const diagnosticsFile = stagedBundleDiagnosticsFile(files);
  const declared = diagnosticsFile ? stringValue(objectOrNull(files?.[diagnosticsFile])?.sha256) : null;
  if (!declared || !SHA_256.test(declared)) return null;
  return { entry, fromRunFolder: false, declaredSha256: declared };
}

/**
 * A staging run's calibration, as `loadStagingCalibration` builds it, from
 * its stored tree's copies: the run's candidate release and time come from
 * its copied documents, and the source is the run's telemetry diagnostics or
 * its staged bundle, as its run manifest says. Null for a run without a
 * current copy or a stored tree, and while the tree holds other diagnostics
 * than the run's files declare: the collector copies a run's files before it
 * builds the run's tree.
 */
async function calibrationFromStore(
  country: MicrocosmCountry,
  runId: string,
  documents: CopiedRunDocuments | null,
  manifest?: CalibrationTreeManifest,
): Promise<Calibration | null> {
  const treeManifest = manifest ?? (await readStoreManifest()).manifest;
  const source = stagingTreeSource(documents, treeManifest, country, runId);
  if (!source) return null;
  const progress = documents?.progress ?? null;
  const runManifest = documents?.runManifest ?? null;
  const candidateReleaseId = candidateReleaseIdOf(runId, progress, runManifest);
  const updatedAt = stringValue(progress?.updated_at) ?? stringValue(runManifest?.updated_at);
  const { entry, fromRunFolder, declaredSha256 } = source;
  const build = entry.buildArtifactId;
  const key = [country, build, candidateReleaseId, updatedAt, fromRunFolder, declaredSha256].join(":");
  return remember(calibrationCache, key, STAGING_CALIBRATION_CACHE_SECONDS, async () => {
    const [diagnostics, buildManifest, releaseManifest] = await Promise.all([
      readBuildCopy(country, build, "calibrationDiagnostics"),
      fromRunFolder ? readBuildCopy(country, build, "buildManifest") : Promise.resolve(null),
      fromRunFolder ? readBuildCopy(country, build, "releaseManifest") : Promise.resolve(null),
    ]);
    if (!diagnostics) {
      throw new StoredCopyMissingError(
        `The collector's store holds no copy of calibration_diagnostics.json for ` +
          `${country} staging run ${runId} (build ${build}).`,
      );
    }
    if (declaredSha256 != null && diagnostics.sha256 !== declaredSha256) return null;
    return buildCalibration(
      diagnostics.payload,
      candidateReleaseId,
      updatedAt,
      buildManifest?.payload ?? {},
      releaseManifest?.payload ?? {},
      {},
      country,
      fromRunFolder ? "huggingface_live" : "huggingface_staged_bundle",
      diagnostics.sha256,
      fromRunFolder ? configuredRepository(country).revision : entry.hfCommitSha,
    );
  });
}

/** A staging run's calibration from the store; null for a run without one. */
export async function loadStoredStagingCalibration(
  runId: string,
  _revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<Calibration | null> {
  if (stagingUnavailableReason(country)) return null;
  assertSafeReleaseId(runId, "run");
  const documents = await readRunDocuments(country, runId, CALIBRATION_DOCUMENTS);
  return calibrationFromStore(country, runId, documents);
}

// --- one run -------------------------------------------------------------

function emptyRunDetail(runId: string) {
  return {
    run_id: runId,
    candidate_release_id: null,
    release_id: null,
    country_code: null,
    run_kind: null,
    non_release: null,
    schema_version: null,
    delivery: null,
    progress: null,
    run_manifest: null,
    calibration_progress: null,
    events: [],
    has_calibration: false,
    calibration: null,
    reform_validation: null,
    build_manifest: null,
    release_manifest: null,
  } satisfies Omit<StagingRunDetail, "available" | "source_repo" | "revision">;
}

/** One Candidate tab run, as `loadStagingRun` gives it, from the copies. */
export async function loadStoredStagingRun(
  runId: string,
  _revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<StagingRunDetail> {
  const unavailable = unavailableStaging(country);
  if (unavailable) return { ...unavailable, ...emptyRunDetail(runId) };
  assertSafeReleaseId(runId, "run");
  const repository = configuredRepository(country);
  const index = await copiedRunIndex(country);
  if (!index) {
    return {
      available: false,
      source_repo: repository.repo,
      revision: repository.revision,
      detail: noCopiesDetail(country),
      ...emptyRunDetail(runId),
    };
  }
  const record = Object.hasOwn(index.runs, runId) ? index.runs[runId] : null;
  const documents = record && !record.removedAt ? await copiedRunDocuments(record) : null;
  const progress = documents?.progress ?? null;
  const runManifest = documents?.runManifest ?? null;
  const calibration = await calibrationFromStore(country, runId, documents);
  const candidateReleaseId = candidateReleaseIdOf(runId, progress, runManifest);
  const identity = progress ?? runManifest;
  return {
    available: true,
    source_repo: repository.repo,
    revision: repository.revision,
    run_id: runId,
    candidate_release_id: candidateReleaseId,
    release_id: stringValue(identity?.release_id),
    country_code: stringValue(identity?.country_code),
    run_kind: stringValue(identity?.run_kind),
    non_release: booleanValue(identity?.non_release),
    schema_version: schemaVersionValue(identity?.schema_version),
    delivery: objectOrNull(identity?.delivery),
    progress,
    run_manifest: runManifest,
    calibration_progress: documents?.calibrationProgress ?? null,
    events: documents?.events ?? [],
    has_calibration: calibration != null,
    calibration: calibration ? latestMicrocosmCalibrationSummary(calibration) : null,
    reform_validation: documents?.reformValidation
      ? buildReformValidation(
          documents.reformValidation,
          candidateReleaseId,
          stringValue(progress?.updated_at),
        )
      : null,
    build_manifest: calibration?.build_manifest ?? null,
    release_manifest: calibration?.release_manifest ?? null,
  };
}

/** A run's telemetry documents, as `loadStagingRunTelemetry` gives them. */
export interface StoredStagingRunTelemetry {
  run_id: string;
  progress: JsonObject | null;
  run_manifest: JsonObject | null;
  calibration_progress: JsonObject | null;
  events: JsonObject[];
}

const TELEMETRY_DOCUMENTS: readonly StagingRunFileName[] = [
  "progress.json",
  "run_manifest.json",
  "calibration_progress.json",
  "events.ndjson",
];

function telemetryOf(runId: string, documents: CopiedRunDocuments | null): StoredStagingRunTelemetry {
  return {
    run_id: runId,
    progress: documents?.progress ?? null,
    run_manifest: documents?.runManifest ?? null,
    calibration_progress: documents?.calibrationProgress ?? null,
    events: documents?.events ?? [],
  };
}

/**
 * The Build progress tab's copied runs: the newest `limit`, ordered as
 * `loadStagingRuns` orders them, with each one's telemetry documents. The
 * country's index is read once. A run `skip` names is listed but not read,
 * so a run whose documents no longer change is read once.
 */
export async function loadStoredStagingTelemetry(
  country: MicrocosmCountry,
  limit: number,
  skip: (runId: string) => boolean = () => false,
): Promise<{
  available: boolean;
  detail: string | null;
  runIds: string[];
  telemetry: Map<string, StoredStagingRunTelemetry>;
  problems: { run_id: string; detail: string }[];
}> {
  const unavailable = unavailableStaging(country);
  if (unavailable) {
    return {
      available: false,
      detail: unavailable.detail,
      runIds: [],
      telemetry: new Map(),
      problems: [],
    };
  }
  const index = await copiedRunIndex(country);
  if (!index) throw new StoredCopyMissingError(noCopiesDetail(country));
  const records = Object.values(index.runs).filter((record) => !record.removedAt);
  const problems = records.flatMap((record) =>
    record.problem === null ? [] : [{ run_id: record.runId, detail: record.problem }],
  );
  const runIds = records
    .filter((record) => record.problem === null)
    .map((record) => record.summary)
    .sort(sortRuns)
    .slice(0, limit)
    .map((summary) => summary.run_id);
  const telemetry = new Map<string, StoredStagingRunTelemetry>();
  await Promise.all(
    runIds
      .filter((runId) => !skip(runId))
      .map(async (runId) => {
        try {
          const record = index.runs[runId];
          telemetry.set(runId, telemetryOf(runId, await copiedRunDocuments(record, TELEMETRY_DOCUMENTS)));
        } catch (error) {
          problems.push({
            run_id: runId,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }),
  );
  return { available: true, detail: null, runIds, telemetry, problems };
}

/** One copied run's telemetry documents, as `loadStagingRunTelemetry` gives them. */
export async function loadStoredStagingRunTelemetry(
  runId: string,
  _revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<StoredStagingRunTelemetry> {
  assertSafeReleaseId(runId, "run");
  return telemetryOf(runId, await readRunDocuments(country, runId, TELEMETRY_DOCUMENTS));
}

// --- comparisons ---------------------------------------------------------

/** A staging run compared with a release, as `loadStagingComparison` gives it. */
export async function loadStoredStagingComparison(
  runId: string,
  releaseId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
) {
  const unavailable = unavailableStaging(country);
  if (unavailable) return { ...unavailable, run_id: runId };
  const [release, staging] = await Promise.all([
    loadStoredRelease(releaseId || "latest", revalidate, country),
    loadStoredStagingCalibration(runId, revalidate, country),
  ]);
  if (!staging) return { available: false, run_id: runId, detail: NOT_UPLOADED };
  return { available: true, run_id: runId, ...buildComparison(release, staging) };
}

/** Two release builds compared, as `loadComparison` gives them. */
export async function loadStoredComparison(
  firstId: string,
  secondId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
) {
  const [first, second] = await Promise.all([
    loadStoredRelease(firstId, revalidate, country),
    loadStoredRelease(secondId, revalidate, country),
  ]);
  return buildComparison(first, second);
}

/** The releases a local-area candidate may be compared with, as `stagingBaselineReleases` lists them. */
async function storedBaselineReleases(
  country: MicrocosmCountry,
  manifest: CalibrationTreeManifest,
): Promise<ReleaseEntry[]> {
  const record = await loadStoredReleasesRecord(0, country);
  if (record) return recordedReleaseInventory(record, country, manifest);
  const folders = await loadStoredReleaseFolders(0, country);
  const tagged = await loadStoredTaggedReleases(0, country, manifest, folders);
  return [...folders, ...tagged];
}

/** The `pipeline.id` a copied run manifest records, as `stagingRunPipelineId` reads it. */
async function storedRunPipelineId(
  runId: string,
  country: MicrocosmCountry,
): Promise<string | null> {
  assertSafeReleaseId(runId, "run");
  const record = (await copiedRunRecords(country)).get(runId);
  const manifest = record
    ? stagingJsonObjectOrNull(await readCopiedJson(record, "run_manifest.json"))
    : null;
  const pipelineId = objectOrNull(manifest?.pipeline)?.id;
  return typeof pipelineId === "string" && pipelineId.trim() ? pipelineId.trim() : null;
}

/** Which release a candidate is compared with, as `resolveStagingComparisonRelease` decides. */
export function resolveStoredStagingComparisonRelease(
  runId: string,
  country: MicrocosmCountry,
): Promise<StagingComparisonRelease> {
  return resolveStagingComparisonRelease(runId, country, {
    runPipelineId: storedRunPipelineId,
    currentReleaseId: async (target) =>
      (await loadStoredPointerReleaseId(300, target)).release_id,
    newestLocalAreaReleaseId: async (target) => {
      const { manifest } = await readStoreManifest();
      const releases = await storedBaselineReleases(target, manifest);
      return newestPublishedLocalAreaRelease(manifest, target, releases)?.releaseId ?? null;
    },
  });
}

const targetChangeCache = new Map<
  string,
  { promise: Promise<ReturnType<typeof buildTargetChangeDataset> | null>; expiresAt: number }
>();

// The run's tree, its documents' status and its calibration, read once for
// the target-change readers. The cache key names the tree and the run's
// declaration, so neither a replaced tree nor a changed declaration is
// answered from an earlier cache entry.
async function targetChangeCandidate(country: MicrocosmCountry, runId: string) {
  const [{ manifest }, documents] = await Promise.all([
    readStoreManifest(),
    readRunDocuments(country, runId, CALIBRATION_DOCUMENTS),
  ]);
  const source = stagingTreeSource(documents, manifest, country, runId);
  return {
    // The tree and the diagnostics the run declares for it.
    tree: source
      ? `${source.entry.buildArtifactId}:${source.declaredSha256 ?? "undeclared"}`
      : "none",
    ttlSeconds: stagingTargetChangeCacheTtlSeconds(documents?.progress?.status),
    calibration: () => calibrationFromStore(country, runId, documents, manifest),
  };
}

/** A candidate's target changes against a release, as `loadStagingTargetChangeDataset` gives them. */
export async function loadStoredStagingTargetChangeDataset(
  runId: string,
  releaseId: string,
  country: MicrocosmCountry = "us",
) {
  if (stagingUnavailableReason(country)) return null;
  assertSafeReleaseId(runId, "run");
  assertSafeReleaseOrBuildFolderId(releaseId, "release");
  const candidate = await targetChangeCandidate(country, runId);
  const dataset = await remember(
    targetChangeCache,
    `${country}:${runId}:${candidate.tree}:${releaseId}`,
    candidate.ttlSeconds,
    async () => {
      const [release, staging] = await Promise.all([
        loadStoredRelease(releaseId, TARGET_CHANGE_FINAL_CACHE_SECONDS, country),
        candidate.calibration(),
      ]);
      return staging ? buildTargetChangeDataset(release, staging) : null;
    },
  );
  if (!dataset) targetChangeCache.delete(`${country}:${runId}:${candidate.tree}:${releaseId}`);
  return dataset;
}

// The tree store's own client, for the comparison source's tree parts.
const treePartReader: typeof getCalibrationTreeBlob = (options) =>
  getCalibrationTreeBlob({
    ...options,
    client: {
      get: (...args) => collectorStoreBlob.get(...args),
      put: () => {
        throw new Error("The comparison source is only read.");
      },
    },
  });

/** A candidate's target changes against a stored build, as `loadStagingTargetChangeDatasetFromBuild` gives them. */
export async function loadStoredStagingTargetChangeDatasetFromBuild(
  runId: string,
  currentBuildArtifactId: string,
  country: MicrocosmCountry = "us",
) {
  if (stagingUnavailableReason(country)) return null;
  assertSafeReleaseId(runId, "run");
  const candidate = await targetChangeCandidate(country, runId);
  const key = `${country}:${runId}:${candidate.tree}:build:${currentBuildArtifactId}`;
  const dataset = await remember(targetChangeCache, key, candidate.ttlSeconds, async () => {
    const [current, staging] = await Promise.all([
      loadCalibrationComparisonSource(country, currentBuildArtifactId, treePartReader),
      candidate.calibration(),
    ]);
    return staging
      ? buildTargetChangeDatasetFromSummaryAndCalibration(
          { country, comparison: current.index.targetComparison, targets: current.targetSummaries },
          staging,
        )
      : null;
  });
  if (!dataset) targetChangeCache.delete(key);
  return dataset;
}

/** A staging run's target diagnostics page, as `loadStagingTargetDiagnostics` gives it. */
export async function loadStoredStagingTargetDiagnostics(
  requestUrl: string,
  runId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
) {
  const unavailable = unavailableStaging(country);
  if (unavailable) return { ...unavailable, run_id: runId };
  const calibration = await loadStoredStagingCalibration(runId, revalidate, country);
  if (!calibration) return { available: false, run_id: runId, detail: NOT_UPLOADED };
  return latestMicrocosmTargetDiagnosticsPage(requestUrl, calibration);
}
