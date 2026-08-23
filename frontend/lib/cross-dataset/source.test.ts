import path from "node:path";

import { afterEach, beforeEach, expect, test } from "bun:test";

import { CrossDatasetArtifactReader } from "./artifact";
import { configuredCrossDatasetReader } from "./source";

const BE_FIXTURE = path.join(import.meta.dir, "fixtures", "be-frontend-bundle");
const BE_RUN_ID = "evaluation-21bc49f29379784a9e2d4cc7";

const ENV_NAMES = [
  "CROSS_DATASET_ARTIFACT_DIR",
  "CROSS_DATASET_ARTIFACT_BASE_URL",
  "CROSS_DATASET_EXPECTED_RUN_ID",
  "CROSS_DATASET_ARTIFACT_DIR_UK",
  "CROSS_DATASET_ARTIFACT_BASE_URL_UK",
  "CROSS_DATASET_EXPECTED_RUN_ID_UK",
  "CROSS_DATASET_ARTIFACT_DIR_BE",
  "CROSS_DATASET_ARTIFACT_BASE_URL_BE",
  "CROSS_DATASET_EXPECTED_RUN_ID_BE",
] as const;

type EnvironmentName = (typeof ENV_NAMES)[number];

let savedEnvironment: Partial<Record<EnvironmentName, string>> = {};

function clearEnvironment() {
  for (const name of ENV_NAMES) delete process.env[name];
}

beforeEach(() => {
  savedEnvironment = {};
  for (const name of ENV_NAMES) {
    const value = process.env[name];
    if (value !== undefined) savedEnvironment[name] = value;
  }
  clearEnvironment();
});

afterEach(() => {
  clearEnvironment();
  for (const [name, value] of Object.entries(savedEnvironment)) {
    process.env[name] = value;
  }
});

test("Belgium directory configuration loads the published bundle summary", async () => {
  process.env.CROSS_DATASET_ARTIFACT_DIR_BE = BE_FIXTURE;
  process.env.CROSS_DATASET_EXPECTED_RUN_ID_BE = BE_RUN_ID;

  const reader = configuredCrossDatasetReader("be");
  expect(configuredCrossDatasetReader("be")).toBe(reader);
  expect((await reader.manifest()).jurisdictions).toEqual(["BE"]);

  const summary = await reader.summary();
  expect(summary.fact_count).toBe(726);
  expect(summary.sources.map((source) => source.source_id)).toEqual([
    "euromod_be2025_jrc_silc",
    "microcosm_be_v04_axiom",
    "microcosm_be_v04_euromod",
  ]);
});

test("directory variables resolve independently for US, UK, and Belgium", async () => {
  const cases = [
    {
      country: "us" as const,
      directoryEnv: "CROSS_DATASET_ARTIFACT_DIR" as const,
      expectedRunIdEnv: "CROSS_DATASET_EXPECTED_RUN_ID" as const,
      expectedCountry: "US",
    },
    {
      country: "uk" as const,
      directoryEnv: "CROSS_DATASET_ARTIFACT_DIR_UK" as const,
      expectedRunIdEnv: "CROSS_DATASET_EXPECTED_RUN_ID_UK" as const,
      expectedCountry: "UK",
    },
    {
      country: "be" as const,
      directoryEnv: "CROSS_DATASET_ARTIFACT_DIR_BE" as const,
      expectedRunIdEnv: "CROSS_DATASET_EXPECTED_RUN_ID_BE" as const,
      expectedCountry: "BE",
    },
  ];

  for (const testCase of cases) {
    clearEnvironment();
    process.env[testCase.directoryEnv] = BE_FIXTURE;
    process.env[testCase.expectedRunIdEnv] = BE_RUN_ID;
    const pending = configuredCrossDatasetReader(testCase.country).manifest();
    if (testCase.country === "be") {
      expect((await pending).jurisdictions).toEqual(["BE"]);
    } else {
      await expect(pending).rejects.toMatchObject({
        code: "stale_artifact",
        message: `Cross-dataset bundle is for jurisdictions BE, not ${testCase.expectedCountry}.`,
      });
    }
  }
});

test("base URL variables resolve independently and name the active country variable", () => {
  const cases = [
    ["us", "CROSS_DATASET_ARTIFACT_BASE_URL"],
    ["uk", "CROSS_DATASET_ARTIFACT_BASE_URL_UK"],
    ["be", "CROSS_DATASET_ARTIFACT_BASE_URL_BE"],
  ] as const;

  for (const [country, baseUrlEnv] of cases) {
    clearEnvironment();
    process.env[baseUrlEnv] = "file:///tmp/cross-dataset";
    expect(() => configuredCrossDatasetReader(country)).toThrow(
      `${baseUrlEnv} must use HTTP(S).`,
    );
  }
});

test("expected run ID variables resolve independently for every country", async () => {
  const cases = [
    ["us", "CROSS_DATASET_ARTIFACT_DIR", "CROSS_DATASET_EXPECTED_RUN_ID"],
    ["uk", "CROSS_DATASET_ARTIFACT_DIR_UK", "CROSS_DATASET_EXPECTED_RUN_ID_UK"],
    ["be", "CROSS_DATASET_ARTIFACT_DIR_BE", "CROSS_DATASET_EXPECTED_RUN_ID_BE"],
  ] as const;

  for (const [country, directoryEnv, expectedRunIdEnv] of cases) {
    clearEnvironment();
    process.env[directoryEnv] = BE_FIXTURE;
    process.env[expectedRunIdEnv] = `wrong-${country}-run`;
    await expect(configuredCrossDatasetReader(country).manifest()).rejects.toMatchObject({
      code: "stale_artifact",
      message: `Expected Cross-dataset run wrong-${country}-run, found ${BE_RUN_ID}.`,
    });
  }
});

test("configuration errors are scoped to and name the selected country", () => {
  const missingCases = [
    ["us", "US", "CROSS_DATASET_ARTIFACT_DIR", "CROSS_DATASET_ARTIFACT_BASE_URL"],
    ["uk", "UK", "CROSS_DATASET_ARTIFACT_DIR_UK", "CROSS_DATASET_ARTIFACT_BASE_URL_UK"],
    ["be", "BE", "CROSS_DATASET_ARTIFACT_DIR_BE", "CROSS_DATASET_ARTIFACT_BASE_URL_BE"],
  ] as const;

  for (const [country, code, directoryEnv, baseUrlEnv] of missingCases) {
    expect(() => configuredCrossDatasetReader(country)).toThrow(
      `Cross-dataset artifacts are not configured for ${code}. Set ${directoryEnv} or ${baseUrlEnv}.`,
    );
  }

  for (const [country, code, directoryEnv, baseUrlEnv] of missingCases) {
    clearEnvironment();
    process.env[directoryEnv] = BE_FIXTURE;
    process.env[baseUrlEnv] = `https://${country}.example/bundle`;
    expect(() => configuredCrossDatasetReader(country)).toThrow(
      `Configure only one of ${directoryEnv} and ${baseUrlEnv} for ${code}.`,
    );
  }

  clearEnvironment();
  process.env.CROSS_DATASET_ARTIFACT_DIR = BE_FIXTURE;
  process.env.CROSS_DATASET_ARTIFACT_DIR_BE = BE_FIXTURE;
  expect(configuredCrossDatasetReader("us")).toBeInstanceOf(CrossDatasetArtifactReader);
  expect(configuredCrossDatasetReader("be")).toBeInstanceOf(CrossDatasetArtifactReader);
});

test("reader caches are retained independently per country and configuration", () => {
  process.env.CROSS_DATASET_ARTIFACT_BASE_URL = "https://us.example/bundle";
  process.env.CROSS_DATASET_ARTIFACT_BASE_URL_UK = "https://uk.example/bundle";
  process.env.CROSS_DATASET_ARTIFACT_DIR_BE = BE_FIXTURE;

  const us = configuredCrossDatasetReader("us");
  const uk = configuredCrossDatasetReader("uk");
  const be = configuredCrossDatasetReader("be");
  expect(new Set([us, uk, be]).size).toBe(3);
  expect(configuredCrossDatasetReader("us")).toBe(us);
  expect(configuredCrossDatasetReader("uk")).toBe(uk);
  expect(configuredCrossDatasetReader("be")).toBe(be);

  process.env.CROSS_DATASET_EXPECTED_RUN_ID_BE = BE_RUN_ID;
  expect(configuredCrossDatasetReader("be")).not.toBe(be);
  expect(configuredCrossDatasetReader("us")).toBe(us);
  expect(configuredCrossDatasetReader("uk")).toBe(uk);
});
