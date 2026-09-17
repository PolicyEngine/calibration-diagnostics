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
  releaseId: "microcosm-us-test-20260915",
  hfCommitSha: "1234567890abcdef1234567890abcdef12345678",
  treeSchemaVersion: 2,
  indexSha256: "b".repeat(64),
  indexBytes: 1234,
  updatedAt: "2026-09-15T12:00:00.000Z",
};

test("manifest updates one country without replacing other country entries", () => {
  const uk = { ...entry, releaseId: "microcosm-uk-test-20260915" };
  const manifest = withCalibrationTreeManifestEntry(
    withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", uk),
    "us",
    entry,
  );
  expect(calibrationTreeManifestEntry(manifest, "us")).toEqual(entry);
  expect(calibrationTreeManifestEntry(manifest, "uk")).toEqual(uk);
  expect(serializeCalibrationTreeManifest(manifest)).toBe(
    serializeCalibrationTreeManifest(parseCalibrationTreeManifest(manifest)),
  );
});

test("manifest validation rejects mutable or malformed content identities", () => {
  expect(() => parseCalibrationTreeManifest({
    schemaVersion: 2,
    countries: { us: { ...entry, hfCommitSha: "main" } },
  })).toThrow("invalid HF commit SHA");
  expect(() => parseCalibrationTreeManifest({
    schemaVersion: 2,
    countries: { us: { ...entry, indexSha256: "short" } },
  })).toThrow("invalid index hash");
});
