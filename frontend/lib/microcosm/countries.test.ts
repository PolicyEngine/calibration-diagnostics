import { expect, test } from "bun:test";

import {
  COUNTRY_CAPABILITIES,
  COUNTRY_REGISTRY,
  DEFAULT_COUNTRY,
  countryCapabilities,
  countryRegistration,
  hasCapability,
  isCountry,
  isCountryCapability,
  parseCountry,
  selectableCountries,
  type MicrocosmCountry,
} from "./countries";

const COUNTRIES = Object.keys(COUNTRY_REGISTRY) as MicrocosmCountry[];

test("every registration carries the full shape", () => {
  for (const country of COUNTRIES) {
    const registration = countryRegistration(country);
    expect(registration.repo).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(registration.revision.length).toBeGreaterThan(0);
    expect(registration.label.length).toBeGreaterThan(0);
    expect(registration.dataset_label.length).toBeGreaterThan(0);
    expect(registration.geography.length).toBeGreaterThan(0);
    expect(
      registration.geography_id === null || registration.geography_id.length > 0,
    ).toBe(true);
    expect(["public", "private"]).toContain(registration.visibility);
    expect(registration.capabilities.length).toBeGreaterThan(0);
    expect(registration.capabilities.every(isCountryCapability)).toBe(true);
    expect(new Set(registration.capabilities).size).toBe(registration.capabilities.length);
    if (registration.repo_env != null || registration.revision_env != null) {
      expect(registration.repo_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(registration.revision_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    if (registration.staging) {
      expect(registration.staging.repo).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(registration.staging.revision.length).toBeGreaterThan(0);
      if (
        registration.staging.repo_env != null ||
        registration.staging.revision_env != null
      ) {
        expect(registration.staging.repo_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(registration.staging.revision_env).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
    expect(hasCapability(country, "staging")).toBe(registration.staging != null);
  }
});

test("keeps the live registrations on their published repositories and labels", () => {
  expect(countryRegistration("us")).toMatchObject({
    repo: "policyengine/populace-us",
    repo_env: "POPULACE_HF_REPO",
    revision_env: "POPULACE_HF_REVISION",
    label: "United States",
    dataset_label: "Microcosm US",
    geography: "United States",
    geography_id: "0100000US",
    visibility: "public",
    capabilities: COUNTRY_CAPABILITIES,
    staging: {
      repo: "policyengine/populace-us-staging",
      repo_env: "POPULACE_STAGING_HF_REPO",
      revision_env: "POPULACE_STAGING_HF_REVISION",
    },
  });
  expect(countryRegistration("uk")).toMatchObject({
    repo: "policyengine/populace-uk-private",
    repo_env: "POPULACE_UK_HF_REPO",
    label: "United Kingdom",
    dataset_label: "Microcosm UK",
    visibility: "private",
    jurisdiction_aliases: ["GB"],
  });
  expect(countryRegistration("be")).toMatchObject({
    repo: "policyengine/populace-be-private",
    repo_env: "POPULACE_BE_HF_REPO",
    label: "Belgium",
    dataset_label: "Microcosm Belgium",
    geography: "Belgium",
    visibility: "private",
  });
});

test("selectable countries follow registry order and exclude fixtures", () => {
  expect(selectableCountries()).toEqual(["us", "uk", "be"]);
  expect(countryRegistration("zz").fixture).toBe(true);
  expect(countryRegistration("am").fixture).toBe(true);
  expect(selectableCountries()).not.toContain("zz");
});

test("fixture registrations are valid countries without being selectable", () => {
  expect(isCountry("zz")).toBe(true);
  expect(isCountry("am")).toBe(true);
  expect(parseCountry("zz")).toBe("zz");
  expect(parseCountry("am")).toBe("am");
});

test("country parsing is exact and defaults to the registry default", () => {
  expect(DEFAULT_COUNTRY).toBe("us");
  expect(parseCountry("be")).toBe("be");
  expect(parseCountry("uk")).toBe("uk");
  expect(parseCountry("us")).toBe("us");
  expect(parseCountry("BE")).toBe(DEFAULT_COUNTRY);
  expect(parseCountry("fr")).toBe(DEFAULT_COUNTRY);
  expect(parseCountry("")).toBe(DEFAULT_COUNTRY);
  expect(parseCountry(null)).toBe(DEFAULT_COUNTRY);
  expect(parseCountry(undefined)).toBe(DEFAULT_COUNTRY);
  expect(isCountry("constructor")).toBe(false);
  expect(isCountry("__proto__")).toBe(false);
  expect(isCountry(null)).toBe(false);
});

test("capability gates read the registration", () => {
  expect(hasCapability("us", "staging")).toBe(true);
  expect(hasCapability("am", "staging")).toBe(true);
  expect(hasCapability("us", "model_coverage")).toBe(true);
  expect(hasCapability("uk", "staging")).toBe(false);
  expect(hasCapability("be", "pipeline")).toBe(false);
  expect(hasCapability("be", "cross_dataset")).toBe(true);
  expect(countryCapabilities("be")).toEqual([
    "calibration",
    "targets",
    "compare",
    "cross_dataset",
  ]);
  expect(countryCapabilities("zz")).toEqual(["calibration", "targets", "compare"]);
  expect(isCountryCapability("staging")).toBe(true);
  expect(isCountryCapability("dashboard_admin")).toBe(false);
  expect(isCountryCapability(7)).toBe(false);
});
