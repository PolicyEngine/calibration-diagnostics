// Which model and data each PolicyEngine surface declares, per country.
//
// The chain is: a surface's dependency lock pins `policyengine` (.py) -> that
// .py tag's bundle manifest (`src/policyengine/data/bundle/manifest.json`)
// certifies one data build and one country-model version per country -> the
// data build is a release on this dashboard. This module reads the *declared*
// side only: the lock file on each repository's default branch, which is not
// necessarily what is deployed. Isomorphic types; the fetchers take an
// injected `fetch` so they can be tested without the network.

import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";

export const PY_REPOSITORY = "PolicyEngine/policyengine.py";
export const PY_BUNDLE_MANIFEST_PATH = "src/policyengine/data/bundle/manifest.json";
export const PY_PYPI_URL = "https://pypi.org/pypi/policyengine/json";

export type LockFormat = "uv" | "requirements";

export interface DeploymentSurface {
  id: string;
  label: string;
  // Public host or product name the surface is known by.
  serves: string;
  repository: string;
  branch: string;
  // A surface that pins no Python packages and takes its model from another
  // surface (the app frontend calls the API).
  via?: string;
  lock?: { path: string; format: LockFormat };
  // Countries the surface serves; omitted means every country .py bundles.
  countries?: readonly MicrocosmCountry[];
  // False for a surface that calculates single households and loads no
  // microdata, so no data build applies to it.
  loads_dataset?: boolean;
  note?: string;
}

export const DEPLOYMENT_SURFACES: readonly DeploymentSurface[] = [
  {
    id: "api",
    label: "PolicyEngine API",
    serves: "api.policyengine.org",
    repository: "PolicyEngine/policyengine-api",
    branch: "master",
    lock: { path: "uv.lock", format: "uv" },
  },
  {
    id: "app-v3",
    label: "App v3",
    serves: "app.policyengine.org, policyengine.org",
    repository: "PolicyEngine/policyengine-app-v2",
    branch: "main",
    via: "api",
    note: "The frontend pins no model; it calls api.policyengine.org.",
  },
  {
    id: "sim-api",
    label: "Simulation API (executor)",
    serves: "policyengine-sim-api simulation executor",
    repository: "PolicyEngine/policyengine-sim-api",
    branch: "main",
    lock: { path: "projects/policyengine-simulation-executor/uv.lock", format: "uv" },
  },
  {
    id: "household-api",
    label: "Household API",
    serves: "household.api.policyengine.org",
    repository: "PolicyEngine/policyengine-household-api",
    branch: "main",
    lock: { path: "uv.lock", format: "uv" },
    // Its country metadata reports `dataset: None` and `data_version: None`.
    loads_dataset: false,
  },
  {
    id: "api-v2-alpha",
    label: "API v2 (alpha)",
    serves: "policyengine-api-v2-alpha",
    repository: "PolicyEngine/policyengine-api-v2-alpha",
    branch: "main",
    lock: { path: "uv.lock", format: "uv" },
  },
  {
    id: "dashboard-runtime",
    label: "This dashboard's variable runtime",
    serves: "calibration-diagnostics hosted runtime",
    repository: "PolicyEngine/calibration-diagnostics",
    branch: "main",
    lock: { path: "backend/requirements.lock", format: "requirements" },
    // Installs only the `us` extra.
    countries: ["us"],
  },
];

const TRACKED_PACKAGES = [
  "policyengine",
  "policyengine-core",
  "policyengine-us",
  "policyengine-uk",
] as const;
export type TrackedPackage = (typeof TRACKED_PACKAGES)[number];
export type LockedVersions = Partial<Record<TrackedPackage, string>>;

const COUNTRY_MODEL_PACKAGE: Partial<Record<MicrocosmCountry, TrackedPackage>> = {
  us: "policyengine-us",
  uk: "policyengine-uk",
};

export function countryModelPackage(country: MicrocosmCountry): TrackedPackage | null {
  return COUNTRY_MODEL_PACKAGE[country] ?? null;
}

function normalizePackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function tracked(name: string): TrackedPackage | null {
  const normalized = normalizePackageName(name);
  return (TRACKED_PACKAGES as readonly string[]).includes(normalized)
    ? (normalized as TrackedPackage)
    : null;
}

// uv.lock: one `[[package]]` table per resolved package, with `name` and
// `version` as its first keys.
export function parseUvLock(text: string): LockedVersions {
  const versions: LockedVersions = {};
  let name: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      name = null;
      continue;
    }
    const match = /^(name|version)\s*=\s*"([^"]*)"/.exec(line);
    if (!match) continue;
    if (match[1] === "name") {
      name = match[2];
    } else if (name) {
      const pkg = tracked(name);
      if (pkg && versions[pkg] === undefined) versions[pkg] = match[2];
      name = null;
    }
  }
  return versions;
}

// pip-compile output: `name[extra]==version \` at the start of a line.
export function parseRequirementsLock(text: string): LockedVersions {
  const versions: LockedVersions = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?==([^\s;\\]+)/.exec(line.trim());
    if (!match) continue;
    const pkg = tracked(match[1]);
    if (pkg && versions[pkg] === undefined) versions[pkg] = match[2];
  }
  return versions;
}

export function parseLock(text: string, format: LockFormat): LockedVersions {
  return format === "uv" ? parseUvLock(text) : parseRequirementsLock(text);
}

export interface BundleCountryRelease {
  build_id: string;
  model_package: string | null;
  certified_model_version: string | null;
}

export interface BundleSummary {
  py_version: string;
  core_version: string | null;
  countries: Partial<Record<string, BundleCountryRelease>>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseBundleManifest(json: unknown, pyVersion: string): BundleSummary {
  const manifest = record(json);
  if (!manifest) throw new Error(`.py ${pyVersion} bundle manifest is not an object`);
  const releases = record(manifest.data_releases) ?? {};
  const packages = record(manifest.packages) ?? {};
  const countries: BundleSummary["countries"] = {};
  for (const [country, value] of Object.entries(releases)) {
    const release = record(value);
    if (!release) continue;
    const certification = record(release.certification);
    const buildId = str(release.build_id) ?? str(certification?.data_build_id);
    if (!buildId) continue;
    const modelPackage =
      str(release.model_package) ??
      str(record(record(manifest.countries)?.[country])?.model_package);
    countries[country] = {
      build_id: buildId,
      model_package: modelPackage,
      certified_model_version:
        str(certification?.certified_for_model_version) ??
        str(record(modelPackage ? packages[modelPackage] : null)?.version),
    };
  }
  return {
    py_version: str(manifest.bundle_version) ?? str(manifest.policyengine_version) ?? pyVersion,
    core_version: str(record(packages["policyengine-core"])?.version),
    countries,
  };
}

export type DeploymentStatus =
  | "current"
  | "behind"
  | "model_mismatch"
  | "no_bundle"
  | "no_py"
  | "not_in_bundle"
  | "no_dataset"
  | "unavailable";

export interface DeploymentRow {
  surface: DeploymentSurface;
  lock_url: string | null;
  py_version: string | null;
  core_version: string | null;
  model_version: string | null;
  // The data build the surface's .py certifies for this country.
  data_build_id: string | null;
  certified_model_version: string | null;
  status: DeploymentStatus;
  detail: string;
}

export interface DeploymentsResponse {
  country: MicrocosmCountry;
  model_package: string | null;
  checked_at: string;
  basis: "declared_default_branch";
  latest: {
    py_version: string;
    data_build_id: string | null;
    certified_model_version: string | null;
  } | null;
  latest_error: string | null;
  rows: DeploymentRow[];
}

export function surfacesForCountry(country: MicrocosmCountry): DeploymentSurface[] {
  return DEPLOYMENT_SURFACES.filter(
    (surface) => !surface.countries || surface.countries.includes(country),
  );
}

// Data builds published by Microcosm are releases on this dashboard; a .py
// bundle can also certify a legacy dataset (e.g. policyengine-uk-data).
export function isMicrocosmBuild(buildId: string): boolean {
  return /^(populace|microcosm)-/.test(buildId);
}

export function rawGitHubUrl(repository: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${repository}/${ref}/${path}`;
}

export function lockUrl(surface: DeploymentSurface): string | null {
  return surface.lock ? rawGitHubUrl(surface.repository, surface.branch, surface.lock.path) : null;
}

export function lockBrowseUrl(surface: DeploymentSurface): string | null {
  return surface.lock
    ? `https://github.com/${surface.repository}/blob/${surface.branch}/${surface.lock.path}`
    : null;
}

export interface SurfaceDeclaration {
  versions: LockedVersions | null;
  error: string | null;
}

// Pure: classify one surface against the bundle its .py carries and the latest
// .py bundle.
export function classifyDeployment(
  surface: DeploymentSurface,
  declaration: SurfaceDeclaration,
  country: MicrocosmCountry,
  bundles: ReadonlyMap<string, BundleSummary | null>,
  latest: BundleSummary | null,
): DeploymentRow {
  const modelPackage = countryModelPackage(country);
  const versions = declaration.versions ?? {};
  const pyVersion = versions.policyengine ?? null;
  const modelVersion = modelPackage ? (versions[modelPackage] ?? null) : null;
  const bundle = pyVersion ? bundles.get(pyVersion) : undefined;
  const release = bundle?.countries[country] ?? null;
  const base = {
    surface,
    lock_url: lockBrowseUrl(surface),
    py_version: pyVersion,
    core_version: versions["policyengine-core"] ?? null,
    model_version: modelVersion,
    data_build_id: release?.build_id ?? null,
    certified_model_version: release?.certified_model_version ?? null,
  };
  const latestRelease = latest?.countries[country] ?? null;

  if (declaration.error) {
    return { ...base, status: "unavailable", detail: declaration.error };
  }
  if (surface.loads_dataset === false) {
    const pin = modelVersion ? `${modelPackage} ${modelVersion}` : "its country model";
    return {
      ...base,
      data_build_id: null,
      certified_model_version: null,
      status: "no_dataset",
      detail: `Calculates single households and loads no microdata. Pins ${pin}${
        pyVersion ? ` through .py ${pyVersion}` : " directly, without .py"
      }.`,
    };
  }
  if (!pyVersion) {
    return {
      ...base,
      status: "no_py",
      detail: modelVersion
        ? `Pins ${modelPackage} ${modelVersion} without .py, so no bundle certifies its data.`
        : "The lock pins neither .py nor the country model.",
    };
  }
  if (bundle === null || bundle === undefined) {
    return {
      ...base,
      status: "no_bundle",
      detail: `.py ${pyVersion} has no bundle manifest, so it certifies no data build.`,
    };
  }
  if (!release) {
    return {
      ...base,
      status: "not_in_bundle",
      detail: `.py ${pyVersion} certifies no ${country.toUpperCase()} data build.`,
    };
  }
  if (
    modelVersion &&
    release.certified_model_version &&
    modelVersion !== release.certified_model_version
  ) {
    return {
      ...base,
      status: "model_mismatch",
      detail:
        `Locks ${modelPackage} ${modelVersion}, but .py ${pyVersion} certifies its data for ` +
        `${release.certified_model_version}.`,
    };
  }
  if (latestRelease && latestRelease.build_id !== release.build_id) {
    return {
      ...base,
      status: "behind",
      detail: `The latest .py ${latest!.py_version} certifies ${latestRelease.build_id}.`,
    };
  }
  return {
    ...base,
    status: "current",
    detail: latest
      ? `Same data build as the latest .py ${latest.py_version}.`
      : "The latest .py version is unknown.",
  };
}

type FetchLike = (input: string, init?: RequestInit & { next?: { revalidate?: number } }) => Promise<Response>;

async function fetchText(fetchImpl: FetchLike, url: string, revalidate: number): Promise<string> {
  const response = await fetchImpl(url, { next: { revalidate } });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.text();
}

export async function loadSurfaceDeclaration(
  surface: DeploymentSurface,
  fetchImpl: FetchLike,
  revalidate: number,
): Promise<SurfaceDeclaration> {
  const url = lockUrl(surface);
  if (!url || !surface.lock) return { versions: null, error: null };
  try {
    return { versions: parseLock(await fetchText(fetchImpl, url, revalidate), surface.lock.format), error: null };
  } catch (error) {
    return { versions: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// null when the tag has no bundle manifest (a .py release before bundles).
export async function loadBundle(
  pyVersion: string,
  fetchImpl: FetchLike,
  revalidate: number,
): Promise<BundleSummary | null> {
  const url = rawGitHubUrl(PY_REPOSITORY, pyVersion, PY_BUNDLE_MANIFEST_PATH);
  const response = await fetchImpl(url, { next: { revalidate } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return parseBundleManifest(await response.json(), pyVersion);
}

export async function loadLatestPyVersion(fetchImpl: FetchLike, revalidate: number): Promise<string> {
  const response = await fetchImpl(PY_PYPI_URL, { next: { revalidate } });
  if (!response.ok) throw new Error(`${response.status} from ${PY_PYPI_URL}`);
  const version = str(record(record(await response.json())?.info)?.version);
  if (!version) throw new Error("PyPI returned no policyengine version");
  return version;
}

export async function loadDeployments(
  country: MicrocosmCountry,
  fetchImpl: FetchLike,
  revalidate: number,
  now: () => Date = () => new Date(),
): Promise<DeploymentsResponse> {
  const surfaces = surfacesForCountry(country);
  const declared = new Map(
    await Promise.all(
      surfaces.map(async (surface) => [surface.id, await loadSurfaceDeclaration(surface, fetchImpl, revalidate)] as const),
    ),
  );

  let latestVersion: string | null = null;
  let latestError: string | null = null;
  try {
    latestVersion = await loadLatestPyVersion(fetchImpl, revalidate);
  } catch (error) {
    latestError = error instanceof Error ? error.message : String(error);
  }

  const pyVersions = new Set<string>();
  for (const declaration of declared.values()) {
    if (declaration.versions?.policyengine) pyVersions.add(declaration.versions.policyengine);
  }
  if (latestVersion) pyVersions.add(latestVersion);

  const bundles = new Map<string, BundleSummary | null>();
  const bundleErrors = new Map<string, string>();
  await Promise.all(
    [...pyVersions].map(async (version) => {
      try {
        bundles.set(version, await loadBundle(version, fetchImpl, revalidate));
      } catch (error) {
        bundleErrors.set(version, error instanceof Error ? error.message : String(error));
      }
    }),
  );
  const latest = latestVersion ? (bundles.get(latestVersion) ?? null) : null;
  if (latestVersion && !latest && !latestError) {
    latestError =
      bundleErrors.get(latestVersion) ?? `.py ${latestVersion} has no bundle manifest.`;
  }

  const rows = surfaces.map((surface) => {
    // A surface that calls another surface inherits its declaration.
    const source = surface.via ? surfaces.find((other) => other.id === surface.via) : surface;
    const declaration = declared.get(source?.id ?? surface.id) ?? { versions: null, error: null };
    const pyVersion = declaration.versions?.policyengine;
    const bundleError = pyVersion ? bundleErrors.get(pyVersion) : undefined;
    const row = classifyDeployment(
      surface,
      bundleError ? { versions: declaration.versions, error: `Bundle manifest: ${bundleError}` } : declaration,
      country,
      bundles,
      latest,
    );
    if (surface.via && source) {
      return {
        ...row,
        lock_url: lockBrowseUrl(source),
        detail: `Through ${source.label}. ${row.detail}`,
      };
    }
    return row;
  });

  const latestRelease = latest?.countries[country] ?? null;
  return {
    country,
    model_package: countryModelPackage(country),
    checked_at: now().toISOString(),
    basis: "declared_default_branch",
    latest: latest
      ? {
          py_version: latest.py_version,
          data_build_id: latestRelease?.build_id ?? null,
          certified_model_version: latestRelease?.certified_model_version ?? null,
        }
      : null,
    latest_error: latestError,
    rows,
  };
}
