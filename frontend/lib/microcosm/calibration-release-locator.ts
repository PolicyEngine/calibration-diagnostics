import { readCalibrationTreeManifest } from "./calibration-tree-blob";
import { calibrationTreeManifestEntry } from "./calibration-tree-manifest";
import type { CalibrationTreeManifest } from "./calibration-tree-manifest";
import {
  countryRegistration,
  type MicrocosmCountry,
} from "./countries";

export interface CalibrationReleaseLocation {
  buildArtifactId: string;
  releaseId: string;
  hfCommitSha: string;
  updatedAt: string | null;
}

export class CalibrationReleaseNotFoundError extends Error {}

function hfHeaders(): HeadersInit | undefined {
  const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function safeReleaseId(value: string, label = "release"): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === "latest") {
    throw new Error(`Invalid ${label} id.`);
  }
  return value;
}

function repository(country: MicrocosmCountry): string {
  const registration = countryRegistration(country);
  return (
    (registration.repo_env ? process.env[registration.repo_env] : undefined) ??
    registration.repo
  );
}

function repositoryRevision(country: MicrocosmCountry): string {
  const registration = countryRegistration(country);
  return (
    (registration.revision_env
      ? process.env[registration.revision_env]
      : undefined) ?? registration.revision
  );
}

export async function resolveHfRevisionSha(
  country: MicrocosmCountry,
  revision: string,
  revalidate = 3600,
): Promise<string> {
  const safeRevision = safeReleaseId(revision, "Hugging Face revision");
  const repo = repository(country);
  const response = await fetch(
    `https://huggingface.co/api/datasets/${repo}/revision/${encodeURIComponent(safeRevision)}`,
    {
      headers: hfHeaders(),
      ...(revalidate <= 0
        ? { cache: "no-store" as const }
        : { next: { revalidate } }),
    },
  );
  if (response.status === 404) {
    throw new CalibrationReleaseNotFoundError(
      `Hugging Face release ${revision} was not found for ${country}.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Hugging Face revision lookup failed with ${response.status}.`);
  }
  const value = (await response.json()) as { sha?: unknown };
  const sha = typeof value.sha === "string" ? value.sha.toLowerCase() : "";
  if (!/^[0-9a-f]{40,64}$/.test(sha)) {
    throw new Error(`Hugging Face returned an invalid commit SHA for ${revision}.`);
  }
  return sha;
}

/**
 * Resolve a release directory that was published without a matching HF tag.
 *
 * The expanded tree response records the commit which last changed each file.
 * The newest of those commits is the first immutable snapshot that contains the
 * current versions of every release artifact in a linear repository history.
 * Callers still fetch every required artifact at the returned commit, so an
 * incomplete or inconsistent snapshot fails publication.
 */
export async function resolveHfReleaseDirectorySha(
  country: MicrocosmCountry,
  release: string,
  revalidate = 0,
): Promise<string> {
  const safeRelease = safeReleaseId(release);
  const repo = repository(country);
  const revision = repositoryRevision(country);
  const prefix = `releases/${safeRelease}/`;
  const response = await fetch(
    `https://huggingface.co/api/datasets/${repo}/tree/` +
      `${encodeURIComponent(revision)}/releases/${encodeURIComponent(safeRelease)}` +
      "?recursive=false&expand=true",
    {
      headers: hfHeaders(),
      ...(revalidate <= 0
        ? { cache: "no-store" as const }
        : { next: { revalidate } }),
    },
  );
  if (response.status === 404) {
    throw new CalibrationReleaseNotFoundError(
      `Hugging Face release directory ${release} was not found for ${country}.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Hugging Face release directory lookup failed with ${response.status}.`,
    );
  }

  const entries = await response.json() as Array<{
    path?: unknown;
    type?: unknown;
    lastCommit?: { id?: unknown; date?: unknown };
  }>;
  if (!Array.isArray(entries)) {
    throw new Error("Hugging Face returned an invalid release directory listing.");
  }
  const files = entries.filter(
    (entry) =>
      entry.type === "file" &&
      typeof entry.path === "string" &&
      entry.path.startsWith(prefix),
  );
  if (!files.some(
    (entry) => entry.path === `${prefix}calibration_diagnostics.json`,
  )) {
    throw new CalibrationReleaseNotFoundError(
      `Hugging Face release ${release} has no calibration diagnostics for ${country}.`,
    );
  }

  const commits = files.map((entry) => {
    const id = typeof entry.lastCommit?.id === "string"
      ? entry.lastCommit.id.toLowerCase()
      : "";
    const date = typeof entry.lastCommit?.date === "string"
      ? Date.parse(entry.lastCommit.date)
      : Number.NaN;
    if (!/^[0-9a-f]{40,64}$/.test(id) || !Number.isFinite(date)) {
      throw new Error(
        `Hugging Face returned invalid commit metadata for release ${release}.`,
      );
    }
    return { id, date };
  });
  commits.sort((left, right) => right.date - left.date);
  if (!commits[0]) {
    throw new CalibrationReleaseNotFoundError(
      `Hugging Face release ${release} has no source files for ${country}.`,
    );
  }
  return commits[0].id;
}

export async function resolveCalibrationRelease(
  country: MicrocosmCountry,
  requestedRelease: string,
  _revalidate = 3600,
): Promise<CalibrationReleaseLocation> {
  const releaseId = requestedRelease && requestedRelease !== "latest"
    ? safeReleaseId(requestedRelease)
    : "latest";
  const { manifest } = await readCalibrationTreeManifest();
  return calibrationReleaseFromManifest(manifest, country, releaseId);
}

export function calibrationReleaseFromManifest(
  manifest: CalibrationTreeManifest,
  country: MicrocosmCountry,
  releaseId = "latest",
): CalibrationReleaseLocation {
  const entry = calibrationTreeManifestEntry(manifest, country, { releaseId });
  if (!entry.releaseId) {
    throw new Error(`Calibration build ${entry.buildArtifactId} is not a release.`);
  }
  return {
    buildArtifactId: entry.buildArtifactId,
    releaseId: entry.releaseId,
    hfCommitSha: entry.hfCommitSha,
    updatedAt: entry.updatedAt,
  };
}
