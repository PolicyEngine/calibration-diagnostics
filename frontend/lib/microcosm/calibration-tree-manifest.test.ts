import { expect, test } from "bun:test";

import {
  calibrationTreeManifestEntry,
  emptyCalibrationTreeManifest,
  parseCalibrationTreeManifest,
  serializeCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifestEntry,
} from "./calibration-tree-manifest";

const entry: CalibrationTreeManifestEntry = {
  buildArtifactId: "a".repeat(64),
  kind: "release",
  sourceId: "microcosm-us-test-20260915",
  label: "microcosm-us-test-20260915",
  releaseId: "microcosm-us-test-20260915",
  stagingRunId: null,
  hfRepo: "policyengine/populace-us",
  hfCommitSha: "1234567890abcdef1234567890abcdef12345678",
  treeSchemaVersion: 5,
  indexSha256: "b".repeat(64),
  indexBytes: 1234,
  createdAt: "2026-09-15T12:00:00.000Z",
  updatedAt: "2026-09-15T12:00:00.000Z",
};

test("manifest updates one country without replacing other country entries", () => {
  const uk = {
    ...entry,
    buildArtifactId: "c".repeat(64),
    sourceId: "microcosm-uk-test-20260915",
    label: "microcosm-uk-test-20260915",
    releaseId: "microcosm-uk-test-20260915",
    hfRepo: "policyengine/populace-uk-private",
  };
  const manifest = withCalibrationTreeManifestEntry(
    withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", uk),
    "us",
    entry,
  );
  expect(calibrationTreeManifestEntry(manifest, "us", {
    releaseId: entry.releaseId!,
  })).toEqual(entry);
  expect(calibrationTreeManifestEntry(manifest, "uk", {
    releaseId: uk.releaseId!,
  })).toEqual(uk);
  expect(serializeCalibrationTreeManifest(manifest)).toBe(
    serializeCalibrationTreeManifest(parseCalibrationTreeManifest(manifest)),
  );
});

test("manifest validation rejects mutable or malformed content identities", () => {
  expect(() => parseCalibrationTreeManifest({
    schemaVersion: 5,
    countries: {
      us: { latestReleaseBuildArtifactId: null, builds: [{ ...entry, hfCommitSha: "main" }] },
    },
  })).toThrow("invalid HF commit SHA");
  expect(() => parseCalibrationTreeManifest({
    schemaVersion: 5,
    countries: {
      us: { latestReleaseBuildArtifactId: null, builds: [{ ...entry, indexSha256: "short" }] },
    },
  })).toThrow("invalid index hash");
  expect(() => parseCalibrationTreeManifest({
    schemaVersion: 4,
    countries: {},
  })).toThrow("Unsupported calibration tree manifest schema 4");
});
