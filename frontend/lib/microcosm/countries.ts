// Country registry for the Microcosm dashboard: the one place a country is
// registered. Adding a country is one entry here; everything else (selectors,
// navigation, repository resolution, national geography, link behaviour) reads
// the registration or the release artifact's typed `country` block.
//
// Isomorphic: imported by client components and API routes alike, so it must
// not import server-only modules or read `process.env`. Deployment overrides
// for repositories are resolved server side in latest-artifact.ts.

import { HOSTED_US_RELEASE } from "./production-release";

export const COUNTRY_CAPABILITIES = [
  "calibration",
  "targets",
  "compare",
  "cross_dataset",
  "staging",
  "model_coverage",
  "pipeline",
  "variables",
  "external_checks",
] as const;
export type CountryCapability = (typeof COUNTRY_CAPABILITIES)[number];

export type RepositoryVisibility = "public" | "private";

export interface CountryRegistration {
  // Default HF dataset repository and revision (the server may override both
  // through the deployment variables named in repo_env / revision_env).
  repo: string;
  revision: string;
  repo_env?: string;
  revision_env?: string;
  // A reviewed immutable production default, distinct from a live latest pointer.
  production_release_id?: string;
  // Country display name ("United States").
  label: string;
  // Sidebar dataset line ("Microcosm US").
  dataset_label: string;
  // National geography label and id (null when the id is unknown).
  geography: string;
  geography_id: string | null;
  visibility: RepositoryVisibility;
  capabilities: readonly CountryCapability[];
  // Optional staging telemetry repository. A staging-capable country must
  // declare this instead of inheriting another country's repository.
  staging?: {
    repo: string;
    revision: string;
    repo_env?: string;
    revision_env?: string;
  };
  // Other jurisdiction codes a cross-dataset bundle may use for this country.
  jurisdiction_aliases?: readonly string[];
  // Conformance-only registration: a valid country that is never listed in
  // selectors or alert allowlists.
  fixture?: true;
}

const ALL_CAPABILITIES: readonly CountryCapability[] = COUNTRY_CAPABILITIES;

const CALIBRATION_CAPABILITIES: readonly CountryCapability[] = [
  "calibration",
  "targets",
  "compare",
  "cross_dataset",
];

// Deprecated upstream identifiers: Microcosm's published HF repositories and
// deployment variables still use the former Populace names.
export const COUNTRY_REGISTRY = {
  us: {
    repo: HOSTED_US_RELEASE.repo,
    revision: HOSTED_US_RELEASE.hf_revision,
    production_release_id: HOSTED_US_RELEASE.release_id,
    repo_env: "POPULACE_HF_REPO",
    revision_env: "POPULACE_HF_REVISION",
    label: "United States",
    dataset_label: "Microcosm US",
    geography: "United States",
    geography_id: "0100000US",
    visibility: "public",
    capabilities: ALL_CAPABILITIES,
    staging: {
      // Deprecated upstream identifier: the US staging publisher still uses
      // the former Populace repository and deployment-variable names.
      repo: "policyengine/populace-us-staging",
      revision: "main",
      repo_env: "POPULACE_STAGING_HF_REPO",
      revision_env: "POPULACE_STAGING_HF_REVISION",
    },
  },
  uk: {
    repo: "policyengine/populace-uk-private",
    revision: "main",
    repo_env: "POPULACE_UK_HF_REPO",
    revision_env: "POPULACE_UK_HF_REVISION",
    label: "United Kingdom",
    dataset_label: "Microcosm UK",
    geography: "United Kingdom",
    geography_id: null,
    visibility: "private",
    capabilities: CALIBRATION_CAPABILITIES,
    jurisdiction_aliases: ["GB"],
  },
  be: {
    repo: "policyengine/populace-be-private",
    revision: "main",
    repo_env: "POPULACE_BE_HF_REPO",
    revision_env: "POPULACE_BE_HF_REVISION",
    label: "Belgium",
    dataset_label: "Microcosm Belgium",
    geography: "Belgium",
    geography_id: null,
    visibility: "private",
    capabilities: CALIBRATION_CAPABILITIES,
  },
  // Synthetic repository used only by the third-country conformance fixture.
  zz: {
    repo: "policyengine/microcosm-zz-fixture",
    revision: "main",
    label: "Zedland",
    dataset_label: "Microcosm ZZ",
    geography: "Zedland",
    geography_id: null,
    visibility: "private",
    capabilities: ["calibration", "targets", "compare"],
    fixture: true,
  },
  // Synthetic non-US staging registration. It verifies that staging artifact
  // resolution is country-scoped without exposing an unfinished country in
  // selectors or treating its fixture repository as a published dataset.
  am: {
    repo: "policyengine/microcosm-am-fixture",
    revision: "main",
    label: "Armenia",
    dataset_label: "Microcosm Armenia",
    geography: "Armenia",
    geography_id: null,
    visibility: "private",
    capabilities: ["calibration", "targets", "compare", "staging"],
    staging: {
      repo: "policyengine/microcosm-am-staging-fixture",
      revision: "main",
    },
    fixture: true,
  },
} satisfies Record<string, CountryRegistration>;

export type MicrocosmCountry = keyof typeof COUNTRY_REGISTRY;

export const DEFAULT_COUNTRY: MicrocosmCountry = "us";

const COUNTRY_CODES = Object.keys(COUNTRY_REGISTRY) as MicrocosmCountry[];

export function isCountry(value: string | null | undefined): value is MicrocosmCountry {
  return value != null && Object.hasOwn(COUNTRY_REGISTRY, value);
}

export function parseCountry(value: string | null | undefined): MicrocosmCountry {
  return isCountry(value) ? value : DEFAULT_COUNTRY;
}

export function countryRegistration(country: MicrocosmCountry): CountryRegistration {
  return COUNTRY_REGISTRY[country];
}

// Countries offered in selectors, in registry order; fixtures are excluded.
export function selectableCountries(): MicrocosmCountry[] {
  return COUNTRY_CODES.filter((country) => !countryRegistration(country).fixture);
}

export function countryCapabilities(country: MicrocosmCountry): readonly CountryCapability[] {
  return COUNTRY_REGISTRY[country].capabilities;
}

export function hasCapability(country: MicrocosmCountry, capability: CountryCapability): boolean {
  return countryCapabilities(country).includes(capability);
}

export function isCountryCapability(value: unknown): value is CountryCapability {
  return typeof value === "string" && (COUNTRY_CAPABILITIES as readonly string[]).includes(value);
}
