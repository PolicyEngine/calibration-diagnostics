import {
  type CalibrationTreeSourceArtifact,
} from "../lib/microcosm/calibration-tree-artifact";
import {
  buildCalibrationTreeBundle,
  type CalibrationTreeBundleFile,
} from "../lib/microcosm/calibration-tree-bundle";
import {
  updateCalibrationTreeManifest,
  uploadCalibrationTreeBundle,
} from "../lib/microcosm/calibration-tree-blob";
import type { CalibrationTreeManifestEntry } from "../lib/microcosm/calibration-tree-manifest";
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
  stagingRepository,
} from "../lib/microcosm/staging-artifact";
import { UnsupportedCalibrationDiagnosticsSchemaError } from "../lib/microcosm/target-representation";

type JsonObject = Record<string, unknown>;

export interface PublisherOptions {
  country: MicrocosmCountry;
  mode: "latest" | "release" | "backfill" | "staging-finalized";
  releaseId?: string;
  hfCommitSha?: string;
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

export class CalibrationTreeArtifactSizeError extends Error {}

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
      argument === "--staging-finalized"
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
    values.has("--release"),
  ].filter(Boolean).length;
  if (selectedModes !== 1) {
    throw new Error(
      "Specify exactly one of --latest, --release, --backfill, or --staging-finalized.",
    );
  }
  if (flags.has("--backfill")) return { country: countryValue, mode: "backfill" };
  if (flags.has("--staging-finalized")) {
    return {
      country: countryValue,
      mode: "staging-finalized",
      ...(values.has("--sha")
        ? { hfCommitSha: exactCommitSha(values.get("--sha"), "--sha") }
        : {}),
    };
  }
  if (flags.has("--latest")) {
    return {
      country: countryValue,
      mode: "latest",
      ...(values.has("--sha")
        ? { hfCommitSha: exactCommitSha(values.get("--sha"), "--sha") }
        : {}),
    };
  }
  return {
    country: countryValue,
    mode: "release",
    releaseId: releaseId(values.get("--release")),
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
) {
  const resolvedSha = await resolvePublicationSourceSha(
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
    createdAt,
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
  const stored = await uploadCalibrationTreeBundle({
    bundle,
    token: blobToken,
  });
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
    treeSchemaVersion: 4,
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

function optionalObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveRepositoryRevisionSha(
  repo: string,
  revision: string,
): Promise<string> {
  const response = await fetch(
    `https://huggingface.co/api/datasets/${repo}/revision/${encodeURIComponent(revision)}`,
    {
      headers: hfHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Hugging Face returned ${response.status} while resolving ${repo}@${revision}.`,
    );
  }
  const payload = object(await response.json(), `${repo}@${revision}`);
  return exactCommitSha(
    typeof payload.sha === "string" ? payload.sha : undefined,
    `${repo}@${revision}`,
  );
}

async function publishFinalizedStagingBuilds(
  country: MicrocosmCountry,
  expectedSha: string | undefined,
  blobToken: string,
): Promise<void> {
  const repository = stagingRepository(country);
  if (!repository) {
    throw new Error(`Staging is not configured for ${country}.`);
  }
  const revisionSha = await resolveRepositoryRevisionSha(
    repository.repo,
    repository.revision,
  );
  if (expectedSha && expectedSha !== revisionSha) {
    throw new Error(
      `Webhook commit ${expectedSha} is no longer the current staging revision ${revisionSha}.`,
    );
  }
  const runs = await loadStagingRuns(0, country);
  if (!runs.available) {
    throw new Error(runs.detail ?? "The staging repository is unavailable.");
  }
  const finalized = runs.runs.filter((run) =>
    ["passed", "published", "completed"].includes(run.status ?? ""),
  );

  for (const run of finalized) {
    const prefix = `runs/${run.run_id}`;
    const runManifest = await fetchJsonArtifactFromRepo(
      repository.repo,
      revisionSha,
      `${prefix}/run_manifest.json`,
      false,
    );
    const artifacts = optionalObject(runManifest?.json.artifacts);
    const diagnosticsArtifact = optionalObject(artifacts?.calibration_diagnostics);
    const diagnosticsPath =
      optionalString(diagnosticsArtifact?.staging_path) ??
      `${prefix}/calibration_diagnostics.json`;
    const [diagnostics, buildManifest, releaseManifest] = await Promise.all([
      fetchJsonArtifactFromRepo(
        repository.repo,
        revisionSha,
        diagnosticsPath,
        true,
      ),
      fetchJsonArtifactFromRepo(
        repository.repo,
        revisionSha,
        `${prefix}/build_manifest.json`,
        false,
      ),
      fetchJsonArtifactFromRepo(
        repository.repo,
        revisionSha,
        `${prefix}/release_manifest.json`,
        false,
      ),
    ]);
    if (!diagnostics) throw new Error(`Staging run ${run.run_id} has no diagnostics.`);
    const declaredDigest = optionalString(diagnosticsArtifact?.sha256);
    if (declaredDigest && declaredDigest !== diagnostics.source.sha256) {
      throw new Error(
        `Staging run ${run.run_id} diagnostics do not match the run manifest digest.`,
      );
    }
    const candidateReleaseId = run.candidate_release_id ?? run.run_id;
    const calibration = buildCalibration(
      diagnostics.json,
      candidateReleaseId,
      run.updated_at,
      buildManifest?.json ?? {},
      releaseManifest?.json ?? {},
      {},
      country,
      "huggingface_immutable",
      diagnostics.source.sha256,
      revisionSha,
    );
    const bundle = buildCalibrationTreeBundle({
      country,
      buildKind: "staging",
      sourceId: run.run_id,
      label: candidateReleaseId,
      createdAt: run.updated_at,
      releaseId: candidateReleaseId,
      hfRepo: repository.repo,
      hfCommitSha: revisionSha,
      sourceArtifacts: {
        calibrationDiagnostics: diagnostics.source,
        buildManifest: buildManifest?.source ?? null,
        releaseManifest: releaseManifest?.source ?? null,
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
    const stored = await uploadCalibrationTreeBundle({ bundle, token: blobToken });
    const entry: CalibrationTreeManifestEntry = {
      buildArtifactId: bundle.index.buildArtifactId,
      kind: "staging",
      sourceId: run.run_id,
      label: candidateReleaseId,
      releaseId: null,
      stagingRunId: run.run_id,
      hfRepo: repository.repo,
      hfCommitSha: revisionSha,
      treeSchemaVersion: 4,
      indexSha256: stored.index.sha256,
      indexBytes: stored.index.bytes,
      createdAt: run.updated_at,
      updatedAt: run.updated_at ?? "1970-01-01T00:00:00.000Z",
    };
    await updateCalibrationTreeManifest({ country, entry, token: blobToken });
    console.log(JSON.stringify({
      country,
      stagingRunId: run.run_id,
      buildArtifactId: entry.buildArtifactId,
      files: stored.files,
    }));
  }

  const verifiedSha = await resolveRepositoryRevisionSha(
    repository.repo,
    repository.revision,
  );
  if (verifiedSha !== revisionSha) {
    throw new Error(
      `Staging repository advanced from ${revisionSha} to ${verifiedSha} during publication.`,
    );
  }
}

export async function runPublisher(options: PublisherOptions): Promise<void> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!blobToken) throw new Error("BLOB_READ_WRITE_TOKEN is required.");

  if (options.mode === "staging-finalized") {
    await publishFinalizedStagingBuilds(
      options.country,
      options.hfCommitSha,
      blobToken,
    );
    return;
  }

  if (options.mode === "backfill") {
    const releases = (await loadReleases(0, options.country)).filter(
      (entry) => entry.has_calibration,
    );
    for (const release of releases) {
      try {
        const published = await publishRelease(
          options.country,
          release.release_id,
          undefined,
          blobToken,
          true,
          release.date,
        );
        await registerReleaseBuild(options.country, published, blobToken);
        console.log(JSON.stringify({
          country: options.country,
          releaseId: release.release_id,
          hfCommitSha: published.bundle.index.build.hfCommitSha,
          buildArtifactId: published.bundle.index.buildArtifactId,
          files: published.stored.files,
          sizes: published.sizes,
        }));
      } catch (error) {
        if (
          !(error instanceof UnsupportedCalibrationDiagnosticsSchemaError) &&
          !(error instanceof CalibrationTreeArtifactSizeError) &&
          !(error instanceof CalibrationReleaseNotFoundError)
        ) {
          throw error;
        }
        console.warn(JSON.stringify({
          country: options.country,
          releaseId: release.release_id,
          skipped: true,
          reason: error.message,
        }));
      }
    }
    const latest = await readUpstreamLatest(options.country);
    const current = await publishRelease(
      options.country,
      latest.releaseId,
      latest.hfCommitSha,
      blobToken,
      true,
      latest.updatedAt,
    );
    const currentEntry = await registerReleaseBuild(
      options.country,
      current,
      blobToken,
    );
    await promoteIfCurrent(options.country, current, currentEntry, blobToken);
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
    selection.updatedAt,
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
