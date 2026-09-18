import { expect, test } from "bun:test";

import { loadCalibrationComparisonSource } from "./calibration-comparison-blob";
import { getCalibrationTreeBlob } from "./calibration-tree-blob";
import { buildCalibrationTreeBundle } from "./calibration-tree-bundle";

const BUILD = "a".repeat(64);

function bundle() {
  return buildCalibrationTreeBundle({
    country: "us",
    buildArtifactId: BUILD,
    releaseId: "release-a",
    hfRepo: "policyengine/populace-us",
    hfCommitSha: BUILD.slice(0, 40),
    sourceArtifacts: {
      calibrationDiagnostics: {
        path: "releases/release-a/calibration_diagnostics.json",
        sha256: BUILD,
      },
      buildManifest: null,
      releaseManifest: null,
      demographics: null,
    },
    rows: [{
      name: "snap|national",
      base_name: "snap|national",
      source: "chronicle",
      variable: "snap",
      target_representation: "hierarchy",
      target_dimensions: [],
      target: 100,
      final_estimate: 105,
      abs_relative_error: 0.05,
      target_loss_weight: 1,
      target_loss_weight_share: 1,
      target_loss_scale: 100,
      final_capped_scaled_error: 0.05,
      final_loss_contribution: 0.05,
      calibration_status: "included",
    }],
    comparison: {
      releaseId: "release-a",
      status: "reported",
      aggregate: 0.05,
      cap: 1,
      basisIdentifier: "basis",
      targetRepresentation: "hierarchy",
    },
  });
}

function blobResult(pathname: string, body: string) {
  return {
    statusCode: 200 as const,
    stream: new Blob([body]).stream(),
    headers: new Headers(),
    blob: {
      url: `https://blob.example/${pathname}`,
      downloadUrl: `https://blob.example/${pathname}?download=1`,
      pathname,
      contentDisposition: "inline",
      cacheControl: "public, max-age=31536000",
      uploadedAt: new Date("2026-09-18T00:00:00.000Z"),
      etag: '"etag"',
      contentType: "application/json; charset=utf-8",
      size: body.length,
    },
  };
}

test("comparison source loading reads only the index and target summaries", async () => {
  const built = bundle();
  const requested: string[] = [];
  const getBlob = (async (options: Parameters<typeof getCalibrationTreeBlob>[0]) => {
    requested.push(options.part);
    const file = built.files.find((candidate) => candidate.part === options.part);
    return file ? blobResult(file.path, file.serialized) : null;
  }) as typeof getCalibrationTreeBlob;

  const source = await loadCalibrationComparisonSource("us", BUILD, getBlob);

  expect(source.targetSummaries).toHaveLength(1);
  expect(requested).toEqual(["index", "target-summary-0001"]);
  expect(requested).not.toContain("filter-index");
  expect(requested.some((part) => part.startsWith("target-details-"))).toBe(false);
});

test("comparison source loading rejects a target-summary digest mismatch", async () => {
  const built = bundle();
  const getBlob = (async (options: Parameters<typeof getCalibrationTreeBlob>[0]) => {
    const file = built.files.find((candidate) => candidate.part === options.part);
    if (!file) return null;
    const body = options.part.startsWith("target-summary-")
      ? `${file.serialized} `
      : file.serialized;
    return blobResult(file.path, body);
  }) as typeof getCalibrationTreeBlob;

  expect(loadCalibrationComparisonSource("us", BUILD, getBlob)).rejects.toThrow(
    "digest is invalid",
  );
});
