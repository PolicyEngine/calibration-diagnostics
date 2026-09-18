import { createHash } from "node:crypto";

import {
  buildCalibrationComparisonBundles,
  calibrationComparisonBuildArtifactId,
  calibrationComparisonPairArtifactId,
  type ComparisonBundleSource,
} from "./calibration-comparison-bundle";
import {
  parseCalibrationTreeIndex,
  parseCalibrationTreeTargetIndex,
} from "./calibration-tree-artifact";
import {
  getCalibrationTreeBlob,
  uploadCalibrationTreeBundle,
} from "./calibration-tree-blob";
import type { MicrocosmCountry } from "./countries";

interface ComparisonBuildIds {
  pairArtifactId: string;
  reportedBuildArtifactId: string;
  sharedBuildArtifactId: string;
}

const activeBuilds = new Map<string, Promise<ComparisonBuildIds>>();
const ACTIVE_BUILD_LIMIT = 8;

function ids(
  country: MicrocosmCountry,
  currentBuildArtifactId: string,
  candidateBuildArtifactId: string,
): ComparisonBuildIds {
  const pairArtifactId = calibrationComparisonPairArtifactId(
    country,
    currentBuildArtifactId,
    candidateBuildArtifactId,
  );
  return {
    pairArtifactId,
    reportedBuildArtifactId: calibrationComparisonBuildArtifactId(
      pairArtifactId,
      "reported",
    ),
    sharedBuildArtifactId: calibrationComparisonBuildArtifactId(
      pairArtifactId,
      "shared",
    ),
  };
}

async function textFromBlob(
  result: Awaited<ReturnType<typeof getCalibrationTreeBlob>>,
  label: string,
): Promise<string> {
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`${label} is unavailable.`);
  }
  return new Response(result.stream).text();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function loadSource(
  country: MicrocosmCountry,
  buildArtifactId: string,
): Promise<ComparisonBundleSource> {
  const indexText = await textFromBlob(
    await getCalibrationTreeBlob({
      country,
      buildArtifactId,
      part: "index",
      consistent: true,
    }),
    `Calibration build ${buildArtifactId} index`,
  );
  const index = parseCalibrationTreeIndex(JSON.parse(indexText));
  if (index.build.kind === "comparison") {
    throw new Error("A derived comparison cannot be used as a source build.");
  }
  const targetIndexText = await textFromBlob(
    await getCalibrationTreeBlob({
      country,
      buildArtifactId,
      part: "target-index",
      consistent: true,
    }),
    `Calibration build ${buildArtifactId} target index`,
  );
  if (sha256(targetIndexText) !== index.parts.targetIndex.sha256) {
    throw new Error(`Calibration build ${buildArtifactId} target index digest is invalid.`);
  }
  const targetIndex = parseCalibrationTreeTargetIndex(
    JSON.parse(targetIndexText),
  );
  if (targetIndex.buildArtifactId !== buildArtifactId) {
    throw new Error(`Calibration build ${buildArtifactId} has inconsistent parts.`);
  }
  return { index, targetIndex };
}

async function comparisonExists(
  country: MicrocosmCountry,
  buildArtifactId: string,
): Promise<boolean> {
  return Boolean(await getCalibrationTreeBlob({
    country,
    buildArtifactId,
    part: "index",
    consistent: true,
  }));
}

async function buildAndPublishComparison(options: {
  country: MicrocosmCountry;
  currentBuildArtifactId: string;
  candidateBuildArtifactId: string;
  token: string;
}): Promise<ComparisonBuildIds> {
  const result = ids(
    options.country,
    options.currentBuildArtifactId,
    options.candidateBuildArtifactId,
  );
  const [reportedExists, sharedExists] = await Promise.all([
    comparisonExists(options.country, result.reportedBuildArtifactId),
    comparisonExists(options.country, result.sharedBuildArtifactId),
  ]);
  if (reportedExists && sharedExists) return result;

  const [current, candidate] = await Promise.all([
    loadSource(options.country, options.currentBuildArtifactId),
    loadSource(options.country, options.candidateBuildArtifactId),
  ]);
  const bundles = buildCalibrationComparisonBundles(current, candidate);
  if (bundles.pairArtifactId !== result.pairArtifactId) {
    throw new Error("Calibration comparison identity is inconsistent.");
  }
  await Promise.all([
    uploadCalibrationTreeBundle({ bundle: bundles.reported, token: options.token }),
    uploadCalibrationTreeBundle({ bundle: bundles.shared, token: options.token }),
  ]);
  return result;
}

export function ensureCalibrationComparison(options: {
  country: MicrocosmCountry;
  currentBuildArtifactId: string;
  candidateBuildArtifactId: string;
  token: string;
}): Promise<ComparisonBuildIds> {
  const key = [
    options.country,
    options.currentBuildArtifactId,
    options.candidateBuildArtifactId,
  ].join(":");
  const existing = activeBuilds.get(key);
  if (existing) return existing;
  const promise = buildAndPublishComparison(options);
  activeBuilds.set(key, promise);
  while (activeBuilds.size > ACTIVE_BUILD_LIMIT) {
    const oldest = activeBuilds.keys().next().value;
    if (typeof oldest !== "string") break;
    activeBuilds.delete(oldest);
  }
  void promise.then(
    () => activeBuilds.delete(key),
    () => activeBuilds.delete(key),
  );
  return promise;
}
