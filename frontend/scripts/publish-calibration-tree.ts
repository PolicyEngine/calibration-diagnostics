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
import { createHash } from "node:crypto";
import {
  CalibrationReleaseNotFoundError,
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
import { UnsupportedCalibrationDiagnosticsSchemaError } from "../lib/microcosm/target-representation";

type JsonObject = Record<string, unknown>;

export interface PublisherOptions {
  country: MicrocosmCountry;
  mode: "latest" | "release" | "backfill";
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

async function fetchJsonArtifact(
  country: MicrocosmCountry,
  revision: string,
  path: string,
  required: boolean,
): Promise<FetchedArtifact | null> {
  const response = await fetch(sourceUrl(country, revision, path), {
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

export function parsePublisherOptions(argv: string[]): PublisherOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--latest" || argument === "--backfill") {
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
    values.has("--release"),
  ].filter(Boolean).length;
  if (selectedModes !== 1) {
    throw new Error("Specify exactly one of --latest, --release, or --backfill.");
  }
  if (flags.has("--backfill")) return { country: countryValue, mode: "backfill" };
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

async function publishRelease(
  country: MicrocosmCountry,
  id: string,
  expectedSha: string | undefined,
  blobToken: string,
  allowMissingReleaseTag = false,
) {
  const resolvedSha = await resolveHfRevisionSha(country, id, 0).catch((error) => {
    if (
      allowMissingReleaseTag &&
      expectedSha &&
      error instanceof CalibrationReleaseNotFoundError
    ) {
      return exactCommitSha(expectedSha, "Fallback source revision");
    }
    throw error;
  });
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
  blobToken: string,
): Promise<boolean> {
  const latest = await readUpstreamLatest(country);
  if (
    latest.releaseId !== candidate.bundle.index.release.releaseId ||
    latest.hfCommitSha !== candidate.bundle.index.release.hfCommitSha
  ) {
    return false;
  }
  await updateCalibrationTreeManifest({
    country,
    token: blobToken,
    entry: {
      releaseId: latest.releaseId,
      hfCommitSha: latest.hfCommitSha,
      treeSchemaVersion: 2,
      indexSha256: candidate.stored.index.sha256,
      indexBytes: candidate.stored.index.bytes,
      updatedAt: latest.updatedAt ?? new Date().toISOString(),
    },
  });
  return true;
}

export async function runPublisher(options: PublisherOptions): Promise<void> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!blobToken) throw new Error("BLOB_READ_WRITE_TOKEN is required.");

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
        );
        console.log(JSON.stringify({
          country: options.country,
          releaseId: release.release_id,
          hfCommitSha: published.bundle.index.release.hfCommitSha,
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
    );
    await promoteIfCurrent(options.country, current, blobToken);
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
  );
  const promoted = await promoteIfCurrent(options.country, published, blobToken);
  console.log(JSON.stringify({
    country: options.country,
    releaseId: published.bundle.index.release.releaseId,
    hfCommitSha: published.bundle.index.release.hfCommitSha,
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
