import {
  CALIBRATION_TREE_SCHEMA_VERSION,
  type CalibrationTreeSourceArtifact,
} from "../lib/microcosm/calibration-tree-artifact";
import {
  buildCalibrationTreeBundle,
  type CalibrationTreeBundleFile,
} from "../lib/microcosm/calibration-tree-bundle";
import {
  auditCalibrationTreeBuild,
  listCalibrationTreeBlobs,
  readCalibrationTreeManifest,
  updateCalibrationTreeManifest,
  uploadCalibrationTreeBundle,
} from "../lib/microcosm/calibration-tree-blob";
import type {
  CalibrationTreeManifest,
  CalibrationTreeManifestEntry,
} from "../lib/microcosm/calibration-tree-manifest";
import { createHash } from "node:crypto";
import {
  CalibrationReleaseNotFoundError,
  resolveHfReleaseDirectorySha,
  resolveHfRevisionSha,
} from "../lib/microcosm/calibration-release-locator";
import {
  isCountry,
  selectableCountries,
  type MicrocosmCountry,
} from "../lib/microcosm/countries";
import {
  buildCalibration,
  loadReleases,
  microcosmRepo,
  microcosmRevision,
} from "../lib/microcosm/latest-artifact";
import {
  loadStagingRuns,
  resolveStagingCalibrationSource,
  resolveStagingRevisionSha,
  stagingRepository,
} from "../lib/microcosm/staging-artifact";

type JsonObject = Record<string, unknown>;

export interface PublisherOptions {
  country: MicrocosmCountry;
  mode:
    | "latest"
    | "release"
    | "backfill"
    | "staging-finalized"
    | "reconcile-releases"
    | "reconcile-staging";
  releaseId?: string;
  hfCommitSha?: string;
  dryRun?: boolean;
}

interface UpstreamLatest {
  releaseId: string;
  hfCommitSha: string;
  updatedAt: string | null;
}

interface FetchedArtifact {
  json: JsonObject;
  source: CalibrationTreeSourceArtifact;
}

const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_MAX_RAW_BYTES = 100_000_000;
const FINAL_STAGING_STATUSES = new Set(["passed", "published", "completed"]);

export class CalibrationTreeArtifactSizeError extends Error {}

export interface ReconciliationOutcome {
  sourceId: string;
  status: "complete" | "published" | "repaired" | "ineligible";
  buildArtifactId: string | null;
  reason: string | null;
}

export interface ReconciliationReport {
  country: MicrocosmCountry;
  sourceKind: "releases" | "staging";
  dryRun: boolean;
  outcomes: ReconciliationOutcome[];
}

export function publicationCreatedAt(
  value: string | null | undefined,
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  const compact = /(?:^|[-_])(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(
    candidate,
  );
  if (compact) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] =
      compact;
    const date = new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ));
    if (
      date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() !== Number(month) - 1 ||
      date.getUTCDate() !== Number(day) ||
      date.getUTCHours() !== Number(hour) ||
      date.getUTCMinutes() !== Number(minute) ||
      date.getUTCSeconds() !== Number(second)
    ) {
      return null;
    }
    return date.toISOString();
  }

  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function releaseId(value: string | undefined): string {
  const result = value?.trim() ?? "";
  if (!RELEASE_ID_RE.test(result) || result === "latest") {
    throw new Error("A valid immutable release id is required.");
  }
  return result;
}

function exactCommitSha(value: string | undefined, label: string): string {
  const result = value?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{40,64}$/.test(result)) {
    throw new Error(`${label} must be an exact Hugging Face commit SHA.`);
  }
  return result;
}

function hfHeaders(): HeadersInit | undefined {
  const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function sourceUrl(
  country: MicrocosmCountry,
  revision: string,
  path: string,
): string {
  return `https://huggingface.co/datasets/${microcosmRepo(country)}/resolve/${revision}/${path}`;
}

function repoSourceUrl(repo: string, revision: string, path: string): string {
  return `https://huggingface.co/datasets/${repo}/resolve/${revision}/${path}`;
}

async function fetchJsonArtifactFromRepo(
  repo: string,
  revision: string,
  path: string,
  required: boolean,
): Promise<FetchedArtifact | null> {
  const response = await fetch(repoSourceUrl(repo, revision, path), {
    headers: hfHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 404 && !required) return null;
  if (!response.ok) {
    throw new Error(`Hugging Face returned ${response.status} for ${path}.`);
  }
  const text = await response.text();
  return {
    json: object(JSON.parse(text), path),
    source: { path, sha256: sha256Text(text) },
  };
}

async function fetchJsonArtifact(
  country: MicrocosmCountry,
  revision: string,
  path: string,
  required: boolean,
): Promise<FetchedArtifact | null> {
  return fetchJsonArtifactFromRepo(
    microcosmRepo(country),
    revision,
    path,
    required,
  );
}

export function parsePublisherOptions(argv: string[]): PublisherOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--latest" ||
      argument === "--backfill" ||
      argument === "--staging-finalized" ||
      argument === "--reconcile-releases" ||
      argument === "--reconcile-staging" ||
      argument === "--dry-run"
    ) {
      flags.add(argument);
      continue;
    }
    if (["--country", "--release", "--sha"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      values.set(argument, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown publisher argument ${argument}.`);
  }

  const countryValue = values.get("--country") ?? "us";
  if (!isCountry(countryValue) || !selectableCountries().includes(countryValue)) {
    throw new Error(`Unknown calibration country ${countryValue}.`);
  }
  const selectedModes = [
    flags.has("--latest"),
    flags.has("--backfill"),
    flags.has("--staging-finalized"),
    flags.has("--reconcile-releases"),
    flags.has("--reconcile-staging"),
    values.has("--release"),
  ].filter(Boolean).length;
  if (selectedModes !== 1) {
    throw new Error(
      "Specify exactly one publication mode.",
    );
  }
  const dryRun = flags.has("--dry-run") || undefined;
  if (
    dryRun &&
    (flags.has("--latest") || values.has("--release"))
  ) {
    throw new Error("--dry-run is supported only by reconciliation modes.");
  }
  if (
    values.has("--sha") &&
    (flags.has("--backfill") || flags.has("--reconcile-releases"))
  ) {
    throw new Error("--sha is not valid for release-history reconciliation.");
  }
  if (flags.has("--backfill")) {
    return { country: countryValue, mode: "backfill", dryRun };
  }
  if (flags.has("--staging-finalized")) {
    return {
      country: countryValue,
      mode: "staging-finalized",
      dryRun,
      ...(values.has("--sha")
        ? { hfCommitSha: exactCommitSha(values.get("--sha"), "--sha") }
        : {}),
    };
  }
  if (flags.has("--reconcile-releases")) {
    return {
      country: countryValue,
      mode: "reconcile-releases",
      dryRun,
    };
  }
  if (flags.has("--reconcile-staging")) {
    return {
      country: countryValue,
      mode: "reconcile-staging",
      dryRun,
      ...(values.has("--sha")
        ? { hfCommitSha: exactCommitSha(values.get("--sha"), "--sha") }
        : {}),
    };
  }
  if (flags.has("--latest")) {
    return {
      country: countryValue,
      mode: "latest",
      dryRun,
      ...(values.has("--sha")
        ? { hfCommitSha: exactCommitSha(values.get("--sha"), "--sha") }
        : {}),
    };
  }
  return {
    country: countryValue,
    mode: "release",
    releaseId: releaseId(values.get("--release")),
    dryRun,
    ...(values.has("--sha")
      ? { hfCommitSha: exactCommitSha(values.get("--sha"), "--sha") }
      : {}),
  };
}

export async function readUpstreamLatest(
  country: MicrocosmCountry,
  expectedSourceSha?: string,
): Promise<UpstreamLatest> {
  const sourceSha = expectedSourceSha
    ? exactCommitSha(expectedSourceSha, "Source revision")
    : await resolveHfRevisionSha(country, microcosmRevision(country), 0);
  const path = "latest.json";
  const response = await fetch(
    sourceUrl(country, sourceSha, path),
    {
      headers: hfHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Hugging Face returned ${response.status} for latest.json.`);
  }
  const pointer = object(await response.json(), "latest.json");
  const id = releaseId(
    typeof pointer.release_id === "string" ? pointer.release_id : undefined,
  );
  const updatedAt =
    typeof pointer.updated_at === "string" && Number.isFinite(Date.parse(pointer.updated_at))
      ? pointer.updated_at
      : null;
  return {
    releaseId: id,
    hfCommitSha: await resolveHfRevisionSha(country, id, 0).catch((error) => {
      if (error instanceof CalibrationReleaseNotFoundError) return sourceSha;
      throw error;
    }),
    updatedAt,
  };
}

interface ReleaseCandidate {
  releaseId: string;
  hfCommitSha: string;
  createdAt: string | null;
}

interface HfTagRef {
  name: string;
  targetCommit: string;
}

async function listReleaseTags(
  country: MicrocosmCountry,
): Promise<HfTagRef[]> {
  const response = await fetch(
    `https://huggingface.co/api/datasets/${microcosmRepo(country)}/refs`,
    {
      headers: hfHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Hugging Face returned ${response.status} while listing release tags.`);
  }
  const payload = object(await response.json(), "Hugging Face refs");
  if (!Array.isArray(payload.tags)) {
    throw new Error("Hugging Face refs response has no tag list.");
  }
  return payload.tags.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const tag = value as JsonObject;
    if (typeof tag.name !== "string" || typeof tag.targetCommit !== "string") return [];
    if (!RELEASE_ID_RE.test(tag.name) || !/^[0-9a-f]{40,64}$/i.test(tag.targetCommit)) {
      return [];
    }
    return [{ name: tag.name, targetCommit: tag.targetCommit.toLowerCase() }];
  });
}

async function taggedReleaseHasDiagnostics(
  country: MicrocosmCountry,
  candidate: HfTagRef,
): Promise<boolean> {
  const response = await fetch(
    `https://huggingface.co/api/datasets/${microcosmRepo(country)}/tree/` +
      `${candidate.targetCommit}/releases/${encodeURIComponent(candidate.name)}?recursive=false`,
    {
      headers: hfHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(
      `Hugging Face returned ${response.status} while inspecting release tag ${candidate.name}.`,
    );
  }
  const entries = await response.json();
  return Array.isArray(entries) && entries.some((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return (value as JsonObject).path ===
      `releases/${candidate.name}/calibration_diagnostics.json`;
  });
}

async function enumerateReleaseCandidates(
  country: MicrocosmCountry,
): Promise<{
  candidates: ReleaseCandidate[];
  ineligible: ReconciliationOutcome[];
}> {
  const [releases, tags] = await Promise.all([
    loadReleases(0, country),
    listReleaseTags(country),
  ]);
  const tagsByName = new Map(tags.map((tag) => [tag.name, tag]));
  const candidates = new Map<string, ReleaseCandidate>();
  const ineligible: ReconciliationOutcome[] = [];

  for (const release of releases) {
    if (!release.has_calibration) continue;
    const tag = tagsByName.get(release.release_id);
    candidates.set(release.release_id, {
      releaseId: release.release_id,
      hfCommitSha: tag?.targetCommit ?? await resolveHfReleaseDirectorySha(
        country,
        release.release_id,
        0,
      ),
      createdAt: publicationCreatedAt(release.date),
    });
  }
  for (const tag of tags) {
    if (candidates.has(tag.name)) continue;
    if (await taggedReleaseHasDiagnostics(country, tag)) {
      candidates.set(tag.name, {
        releaseId: tag.name,
        hfCommitSha: tag.targetCommit,
        createdAt: publicationCreatedAt(tag.name),
      });
    } else {
      ineligible.push({
        sourceId: tag.name,
        status: "ineligible",
        buildArtifactId: null,
        reason: "Release has no calibration diagnostics.",
      });
    }
  }
  for (const release of releases) {
    if (!release.has_calibration && !ineligible.some((item) => item.sourceId === release.release_id)) {
      ineligible.push({
        sourceId: release.release_id,
        status: "ineligible",
        buildArtifactId: null,
        reason: "Release has no calibration diagnostics.",
      });
    }
  }
  return {
    candidates: [...candidates.values()].sort((left, right) =>
      left.releaseId.localeCompare(right.releaseId)
    ),
    ineligible,
  };
}

export function manifestBuildForSource(
  manifest: CalibrationTreeManifest,
  country: MicrocosmCountry,
  kind: "release" | "staging",
  sourceId: string,
): CalibrationTreeManifestEntry | null {
  const matches = (manifest.countries[country]?.builds ?? []).filter((entry) =>
    entry.kind === kind &&
    (kind === "release"
      ? entry.releaseId === sourceId
      : entry.stagingRunId === sourceId)
  );
  if (matches.length > 1) {
    throw new Error(`Calibration source ${sourceId} has multiple manifest entries.`);
  }
  return matches[0] ?? null;
}

export function enforceConfiguredSizeLimits(file: CalibrationTreeBundleFile): {
  rawBytes: number;
  gzipBytes: number;
} {
  const { rawBytes, gzipBytes } = file;
  const limits = [
    ["CALIBRATION_TREE_MAX_RAW_BYTES", rawBytes, DEFAULT_MAX_RAW_BYTES],
    ["CALIBRATION_TREE_MAX_GZIP_BYTES", gzipBytes],
  ] as const;
  for (const [name, actual, defaultLimit] of limits) {
    const configured = process.env[name]?.trim();
    const limit = configured ? Number(configured) : defaultLimit;
    if (limit == null) continue;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error(`${name} must be a positive integer.`);
    }
    if (actual > limit) {
      throw new CalibrationTreeArtifactSizeError(
        `${file.path} exceeded ${name}: ${actual} bytes is greater than ${limit}.`,
      );
    }
  }
  return { rawBytes, gzipBytes };
}

export async function resolvePublicationSourceSha(
  country: MicrocosmCountry,
  id: string,
  expectedSha: string | undefined,
  allowReleaseDirectoryLookup: boolean,
): Promise<string> {
  try {
    return await resolveHfRevisionSha(country, id, 0);
  } catch (error) {
    if (error instanceof CalibrationReleaseNotFoundError && expectedSha) {
      return exactCommitSha(expectedSha, "Fallback source revision");
    }
    if (
      error instanceof CalibrationReleaseNotFoundError &&
      allowReleaseDirectoryLookup
    ) {
      return resolveHfReleaseDirectorySha(country, id, 0);
    }
    throw error;
  }
}

async function publishRelease(
  country: MicrocosmCountry,
  id: string,
  expectedSha: string | undefined,
  blobToken: string,
  allowMissingReleaseTag = false,
  createdAt: string | null = null,
  useExpectedShaExactly = false,
  buildArtifactId?: string,
  dryRun = false,
  expectedIndexSha256?: string,
) {
  const resolvedSha = useExpectedShaExactly && expectedSha
    ? exactCommitSha(expectedSha, "Exact source revision")
    : await resolvePublicationSourceSha(
        country,
        id,
        expectedSha,
        allowMissingReleaseTag,
      );
  if (expectedSha && expectedSha.toLowerCase() !== resolvedSha) {
    throw new Error(
      `Webhook commit ${expectedSha} does not match release ${id} commit ${resolvedSha}.`,
    );
  }
  const prefix = `releases/${id}`;
  const [diagnostics, buildManifest, releaseManifest, demographics] =
    await Promise.all([
      fetchJsonArtifact(
        country,
        resolvedSha,
        `${prefix}/calibration_diagnostics.json`,
        true,
      ),
      fetchJsonArtifact(country, resolvedSha, `${prefix}/build_manifest.json`, false),
      fetchJsonArtifact(country, resolvedSha, `${prefix}/release_manifest.json`, false),
      fetchJsonArtifact(country, resolvedSha, `${prefix}/demographics.json`, false),
    ]);
  if (!diagnostics) throw new Error("Calibration diagnostics are missing.");

  const calibration = buildCalibration(
    diagnostics.json,
    id,
    null,
    buildManifest?.json ?? {},
    releaseManifest?.json ?? {},
    demographics?.json ?? {},
    country,
    "huggingface_immutable",
    diagnostics.source.sha256,
    resolvedSha,
  );
  const bundle = buildCalibrationTreeBundle({
    country,
    ...(buildArtifactId ? { buildArtifactId } : {}),
    createdAt: publicationCreatedAt(id) ?? publicationCreatedAt(createdAt),
    releaseId: id,
    hfRepo: microcosmRepo(country),
    hfCommitSha: resolvedSha,
    sourceArtifacts: {
      calibrationDiagnostics: diagnostics.source,
      buildManifest: buildManifest?.source ?? null,
      releaseManifest: releaseManifest?.source ?? null,
      demographics: demographics?.source ?? null,
    },
    rows: calibration.rows,
    calibrationProvenance: calibration.calibration_provenance,
    lossAttributionAvailable:
      calibration.target_loss_attribution.status !== "unavailable",
    comparison: {
      releaseId: calibration.release_id,
      calibrationProvenance: calibration.calibration_provenance,
      status: calibration.target_loss_attribution.status,
      aggregate: calibration.target_loss_attribution.aggregate,
      cap: calibration.target_loss_attribution.cap,
      basisIdentifier: calibration.target_loss_attribution.basis_identifier,
      targetRepresentation: calibration.target_schema.target_representation,
    },
  });
  const sizes = Object.fromEntries(
    bundle.files.map((file) => [file.part, enforceConfiguredSizeLimits(file)]),
  );
  const builtIndex = bundle.files.find((candidate) => candidate.part === "index");
  if (!builtIndex) throw new Error("Calibration tree bundle has no index.");
  if (expectedIndexSha256 && builtIndex.sha256 !== expectedIndexSha256) {
    throw new Error(
      `Rebuilt calibration index differs from immutable manifest entry ${buildArtifactId}.`,
    );
  }
  const stored = dryRun
    ? {
        files: bundle.files.map((file) => ({
          pathname: file.path,
          sha256: file.sha256,
          bytes: file.rawBytes,
          created: false,
        })),
        index: (() => {
          return {
            pathname: builtIndex.path,
            sha256: builtIndex.sha256,
            bytes: builtIndex.rawBytes,
            created: false,
          };
        })(),
      }
    : await uploadCalibrationTreeBundle({ bundle, token: blobToken });
  return { bundle, stored, sizes };
}

async function promoteIfCurrent(
  country: MicrocosmCountry,
  candidate: Awaited<ReturnType<typeof publishRelease>>,
  entry: CalibrationTreeManifestEntry,
  blobToken: string,
): Promise<boolean> {
  const latest = await readUpstreamLatest(country);
  if (
    latest.releaseId !== candidate.bundle.index.build.releaseId ||
    latest.hfCommitSha !== candidate.bundle.index.build.hfCommitSha
  ) {
    return false;
  }
  await updateCalibrationTreeManifest({
    country,
    token: blobToken,
    entry,
    makeLatest: true,
  });
  return true;
}

function releaseManifestEntry(
  published: Awaited<ReturnType<typeof publishRelease>>,
): CalibrationTreeManifestEntry {
  const build = published.bundle.index.build;
  if (!build.releaseId || !build.hfRepo || !build.hfCommitSha) {
    throw new Error("Published release build is missing release provenance.");
  }
  return {
    buildArtifactId: build.buildArtifactId,
    kind: "release",
    sourceId: build.sourceId,
    label: build.label,
    releaseId: build.releaseId,
    stagingRunId: null,
    hfRepo: build.hfRepo,
    hfCommitSha: build.hfCommitSha,
    treeSchemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
    indexSha256: published.stored.index.sha256,
    indexBytes: published.stored.index.bytes,
    createdAt: build.createdAt,
    updatedAt: build.createdAt ?? "1970-01-01T00:00:00.000Z",
  };
}

async function registerReleaseBuild(
  country: MicrocosmCountry,
  published: Awaited<ReturnType<typeof publishRelease>>,
  blobToken: string,
): Promise<CalibrationTreeManifestEntry> {
  const entry = releaseManifestEntry(published);
  await updateCalibrationTreeManifest({ country, entry, token: blobToken });
  return entry;
}

type ResolvedStagingSource = NonNullable<
  Awaited<ReturnType<typeof resolveStagingCalibrationSource>>
>;

async function publishStagingSource(options: {
  country: MicrocosmCountry;
  runId: string;
  source: ResolvedStagingSource;
  repository: { repo: string };
  revisionSha: string;
  blobToken: string;
  existing: CalibrationTreeManifestEntry | null;
  existingIndex: Awaited<ReturnType<typeof auditCalibrationTreeBuild>>["index"];
  dryRun: boolean;
}) {
  const {
    country,
    runId,
    source,
    repository,
    revisionSha,
    blobToken,
    existing,
    existingIndex,
    dryRun,
  } = options;
  const { calibration } = source;
  const candidateReleaseId = source.candidateReleaseId;
  const bundle = buildCalibrationTreeBundle({
    country,
    ...(existing ? { buildArtifactId: existing.buildArtifactId } : {}),
    buildKind: "staging",
    sourceId: runId,
    label: existingIndex?.build.label ?? candidateReleaseId,
    createdAt: existingIndex?.build.createdAt ?? source.updatedAt,
    releaseId: existingIndex?.build.releaseId ?? candidateReleaseId,
    hfRepo: existing?.hfRepo ?? repository.repo,
    hfCommitSha: existing?.hfCommitSha ?? revisionSha,
    sourceArtifacts: existingIndex?.build.sourceArtifacts ?? {
      ...source.sourceArtifacts,
      demographics: null,
    },
    rows: calibration.rows,
    calibrationProvenance: calibration.calibration_provenance,
    lossAttributionAvailable:
      calibration.target_loss_attribution.status !== "unavailable",
    comparison: {
      releaseId: calibration.release_id,
      calibrationProvenance: calibration.calibration_provenance,
      status: calibration.target_loss_attribution.status,
      aggregate: calibration.target_loss_attribution.aggregate,
      cap: calibration.target_loss_attribution.cap,
      basisIdentifier: calibration.target_loss_attribution.basis_identifier,
      targetRepresentation: calibration.target_schema.target_representation,
    },
  });
  for (const file of bundle.files) enforceConfiguredSizeLimits(file);
  const indexFile = bundle.files.find((file) => file.part === "index");
  if (!indexFile) throw new Error("Calibration tree bundle has no index.");
  if (existing && indexFile.sha256 !== existing.indexSha256) {
    throw new Error(
      `Rebuilt staging index differs from immutable manifest entry ${existing.buildArtifactId}.`,
    );
  }
  const stored = dryRun
    ? {
        files: bundle.files.map((file) => ({
          pathname: file.path,
          sha256: file.sha256,
          bytes: file.rawBytes,
          created: false,
        })),
        index: {
          pathname: indexFile.path,
          sha256: indexFile.sha256,
          bytes: indexFile.rawBytes,
          created: false,
        },
      }
    : await uploadCalibrationTreeBundle({ bundle, token: blobToken });
  const entry: CalibrationTreeManifestEntry = existing ?? {
    buildArtifactId: bundle.index.buildArtifactId,
    kind: "staging",
    sourceId: runId,
    label: candidateReleaseId,
    releaseId: null,
    stagingRunId: runId,
    hfRepo: repository.repo,
    hfCommitSha: revisionSha,
    treeSchemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
    indexSha256: stored.index.sha256,
    indexBytes: stored.index.bytes,
    createdAt: source.updatedAt,
    updatedAt: source.updatedAt ?? "1970-01-01T00:00:00.000Z",
  };
  return { bundle, stored, entry };
}

async function reconcileStagingBuilds(
  country: MicrocosmCountry,
  expectedSha: string | undefined,
  blobToken: string,
  dryRun: boolean,
): Promise<ReconciliationReport> {
  const repository = stagingRepository(country);
  if (!repository) {
    throw new Error(`Staging is not configured for ${country}.`);
  }
  const revisionSha = expectedSha
    ? exactCommitSha(expectedSha, "Staging source revision")
    : await resolveStagingRevisionSha(country);
  const runs = await loadStagingRuns(0, country, revisionSha);
  if (!runs.available) {
    throw new Error(runs.detail ?? "The staging repository is unavailable.");
  }
  if (runs.incompatible_runs.length > 0) {
    throw new Error(
      `Staging inventory contains incompatible runs: ${runs.incompatible_runs
        .map((run) => run.run_id)
        .join(", ")}.`,
    );
  }
  const finalized = runs.runs.filter((run) =>
    FINAL_STAGING_STATUSES.has(run.status ?? ""),
  );
  let { manifest } = await readCalibrationTreeManifest({
    token: blobToken,
    consistent: true,
  });
  let blobs = await listCalibrationTreeBlobs({ country, token: blobToken });
  const outcomes: ReconciliationOutcome[] = [];

  for (const run of finalized) {
    const existing = manifestBuildForSource(
      manifest,
      country,
      "staging",
      run.run_id,
    );
    const audit = existing
      ? await auditCalibrationTreeBuild({
          country,
          entry: existing,
          blobs,
          token: blobToken,
        })
      : null;
    if (existing && audit?.complete) {
      outcomes.push({
        sourceId: run.run_id,
        status: "complete",
        buildArtifactId: existing.buildArtifactId,
        reason: null,
      });
      continue;
    }
    if (audit && !audit.repairable) {
      throw new Error(
        `Staging build ${run.run_id} is corrupt and cannot be repaired automatically: ` +
          audit.reasons.join("; "),
      );
    }
    const source = await resolveStagingCalibrationSource(
      run.run_id,
      0,
      country,
      existing?.hfCommitSha ?? revisionSha,
    );
    if (!source) {
      if (existing) {
        throw new Error(
          `Incomplete staging build ${run.run_id} no longer has calibration diagnostics.`,
        );
      }
      outcomes.push({
        sourceId: run.run_id,
        status: "ineligible",
        buildArtifactId: null,
        reason: "Finalized staging run has no calibration diagnostics.",
      });
      continue;
    }
    const published = await publishStagingSource({
      country,
      runId: run.run_id,
      source,
      repository,
      revisionSha: existing?.hfCommitSha ?? revisionSha,
      blobToken,
      existing,
      existingIndex: audit?.index ?? null,
      dryRun,
    });
    if (!dryRun) {
      manifest = await updateCalibrationTreeManifest({
        country,
        entry: published.entry,
        token: blobToken,
      });
      blobs = await listCalibrationTreeBlobs({ country, token: blobToken });
      const verified = await auditCalibrationTreeBuild({
        country,
        entry: published.entry,
        blobs,
        token: blobToken,
      });
      if (!verified.complete) {
        throw new Error(
          `Staging build ${run.run_id} remains incomplete: ${verified.reasons.join("; ")}`,
        );
      }
    }
    outcomes.push({
      sourceId: run.run_id,
      status: existing ? "repaired" : "published",
      buildArtifactId: published.entry.buildArtifactId,
      reason: dryRun ? "Dry run; no Blob writes performed." : null,
    });
  }
  return { country, sourceKind: "staging", dryRun, outcomes };
}

async function reconcileReleaseBuilds(
  country: MicrocosmCountry,
  blobToken: string,
  dryRun: boolean,
): Promise<ReconciliationReport> {
  const inventory = await enumerateReleaseCandidates(country);
  let { manifest } = await readCalibrationTreeManifest({
    token: blobToken,
    consistent: true,
  });
  let blobs = await listCalibrationTreeBlobs({ country, token: blobToken });
  const outcomes = [...inventory.ineligible];

  for (const candidate of inventory.candidates) {
    const existing = manifestBuildForSource(
      manifest,
      country,
      "release",
      candidate.releaseId,
    );
    if (existing && existing.hfCommitSha !== candidate.hfCommitSha) {
      throw new Error(
        `Released dataset ${candidate.releaseId} changed from ${existing.hfCommitSha} ` +
          `to ${candidate.hfCommitSha}.`,
      );
    }
    const audit = existing
      ? await auditCalibrationTreeBuild({
          country,
          entry: existing,
          blobs,
          token: blobToken,
        })
      : null;
    if (existing && audit?.complete) {
      outcomes.push({
        sourceId: candidate.releaseId,
        status: "complete",
        buildArtifactId: existing.buildArtifactId,
        reason: null,
      });
      continue;
    }
    if (audit && !audit.repairable) {
      throw new Error(
        `Release build ${candidate.releaseId} is corrupt and cannot be repaired automatically: ` +
          audit.reasons.join("; "),
      );
    }
    const published = await publishRelease(
      country,
      candidate.releaseId,
      existing?.hfCommitSha ?? candidate.hfCommitSha,
      blobToken,
      false,
      candidate.createdAt,
      true,
      existing?.buildArtifactId,
      dryRun,
      existing?.indexSha256,
    );
    const entry = existing ?? releaseManifestEntry(published);
    if (!dryRun) {
      manifest = await updateCalibrationTreeManifest({ country, entry, token: blobToken });
      blobs = await listCalibrationTreeBlobs({ country, token: blobToken });
      const verified = await auditCalibrationTreeBuild({
        country,
        entry,
        blobs,
        token: blobToken,
      });
      if (!verified.complete) {
        throw new Error(
          `Release build ${candidate.releaseId} remains incomplete: ${verified.reasons.join("; ")}`,
        );
      }
    }
    outcomes.push({
      sourceId: candidate.releaseId,
      status: existing ? "repaired" : "published",
      buildArtifactId: entry.buildArtifactId,
      reason: dryRun ? "Dry run; no Blob writes performed." : null,
    });
  }

  const latest = await readUpstreamLatest(country);
  const latestEntry = manifestBuildForSource(
    manifest,
    country,
    "release",
    latest.releaseId,
  );
  if (!dryRun) {
    if (!latestEntry || latestEntry.hfCommitSha !== latest.hfCommitSha) {
      throw new Error(
        `Latest release ${latest.releaseId}@${latest.hfCommitSha} is not completely published.`,
      );
    }
    await updateCalibrationTreeManifest({
      country,
      entry: latestEntry,
      token: blobToken,
      makeLatest: true,
    });
  }
  return { country, sourceKind: "releases", dryRun, outcomes };
}

export async function runPublisher(options: PublisherOptions): Promise<void> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!blobToken) throw new Error("BLOB_READ_WRITE_TOKEN is required.");

  if (
    options.mode === "staging-finalized" ||
    options.mode === "reconcile-staging"
  ) {
    const report = await reconcileStagingBuilds(
      options.country,
      options.hfCommitSha,
      blobToken,
      options.dryRun === true,
    );
    console.log(JSON.stringify(report));
    return;
  }

  if (
    options.mode === "backfill" ||
    options.mode === "reconcile-releases"
  ) {
    const report = await reconcileReleaseBuilds(
      options.country,
      blobToken,
      options.dryRun === true,
    );
    console.log(JSON.stringify(report));
    return;
  }

  const selection = options.mode === "latest"
    ? await readUpstreamLatest(options.country, options.hfCommitSha)
    : {
        releaseId: releaseId(options.releaseId),
        hfCommitSha: options.hfCommitSha,
        updatedAt: null,
      };
  const published = await publishRelease(
    options.country,
    selection.releaseId,
    selection.hfCommitSha,
    blobToken,
    options.mode === "latest",
    publicationCreatedAt(selection.updatedAt),
  );
  const entry = await registerReleaseBuild(options.country, published, blobToken);
  const promoted = await promoteIfCurrent(
    options.country,
    published,
    entry,
    blobToken,
  );
  console.log(JSON.stringify({
    country: options.country,
    releaseId: published.bundle.index.build.releaseId,
    hfCommitSha: published.bundle.index.build.hfCommitSha,
    buildArtifactId: published.bundle.index.buildArtifactId,
    files: published.stored.files,
    sizes: published.sizes,
    promoted,
  }));
}

if (import.meta.main) {
  try {
    await runPublisher(parsePublisherOptions(Bun.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
