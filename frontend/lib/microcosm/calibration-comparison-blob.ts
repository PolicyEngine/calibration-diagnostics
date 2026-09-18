import { createHash } from "node:crypto";

import {
  buildCalibrationComparisonBundles,
  calibrationComparisonBuildArtifactId,
  calibrationComparisonPairArtifactId,
  type ComparisonBundleSource,
} from "./calibration-comparison-bundle";
import {
  calibrationTreeTargetsFromSummaries,
  parseCalibrationTreeIndex,
  parseCalibrationTreeTargetSummary,
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

export async function loadCalibrationComparisonSource(
  country: MicrocosmCountry,
  buildArtifactId: string,
  getBlob: typeof getCalibrationTreeBlob = getCalibrationTreeBlob,
): Promise<ComparisonBundleSource> {
  const indexText = await textFromBlob(
    await getBlob({
      country,
      buildArtifactId,
      part: "index",
      consistent: true,
    }),
    `Calibration build ${buildArtifactId} index`,
  );
  const index = parseCalibrationTreeIndex(JSON.parse(indexText));
  if (index.country !== country || index.buildArtifactId !== buildArtifactId) {
    throw new Error(`Calibration build ${buildArtifactId} index identity is inconsistent.`);
  }
  if (index.build.kind === "comparison") {
    throw new Error("A derived comparison cannot be used as a source build.");
  }
  const targetSummaries = await Promise.all(
    index.parts.targetSummaries.map(async (descriptor) => {
      const text = await textFromBlob(
        await getBlob({
          country,
          buildArtifactId,
          part: descriptor.part,
          consistent: true,
        }),
        `Calibration build ${buildArtifactId} ${descriptor.part}`,
      );
      if (sha256(text) !== descriptor.sha256) {
        throw new Error(
          `Calibration build ${buildArtifactId} ${descriptor.part} digest is invalid.`,
        );
      }
      return parseCalibrationTreeTargetSummary(JSON.parse(text), descriptor.part);
    }),
  );
  return {
    index,
    indexSha256: sha256(indexText),
    targetSummaries: calibrationTreeTargetsFromSummaries(index, targetSummaries),
  };
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
    loadCalibrationComparisonSource(options.country, options.currentBuildArtifactId),
    loadCalibrationComparisonSource(options.country, options.candidateBuildArtifactId),
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
