import { readCalibrationTreeManifest } from "./calibration-tree-blob";
import { calibrationTreeManifestEntry } from "./calibration-tree-manifest";
import type { CalibrationTreeLatestManifestV2 } from "./calibration-tree-manifest";
import {
  countryRegistration,
  type MicrocosmCountry,
} from "./countries";

export interface CalibrationReleaseLocation {
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

export async function resolveCalibrationRelease(
  country: MicrocosmCountry,
  requestedRelease: string,
  revalidate = 3600,
): Promise<CalibrationReleaseLocation> {
  if (!requestedRelease || requestedRelease === "latest") {
    const { manifest } = await readCalibrationTreeManifest();
    return calibrationReleaseFromManifest(manifest, country);
  }
  const releaseId = safeReleaseId(requestedRelease);
  return {
    releaseId,
    hfCommitSha: await resolveHfRevisionSha(country, releaseId, revalidate),
    updatedAt: null,
  };
}

export function calibrationReleaseFromManifest(
  manifest: CalibrationTreeLatestManifestV2,
  country: MicrocosmCountry,
): CalibrationReleaseLocation {
  const entry = calibrationTreeManifestEntry(manifest, country);
  return {
    releaseId: entry.releaseId,
    hfCommitSha: entry.hfCommitSha,
    updatedAt: entry.updatedAt,
  };
}
