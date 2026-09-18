import { afterEach, expect, test } from "bun:test";

import {
  calibrationComparisonBuildArtifactId,
  calibrationComparisonPairArtifactId,
} from "@/lib/microcosm/calibration-comparison-bundle";
import {
  createCalibrationComparisonTreeHandler,
  type CalibrationComparisonTreeRouteDependencies,
} from "./route";

const CURRENT = "a".repeat(64);
const CANDIDATE = "b".repeat(64);
const PAIR = calibrationComparisonPairArtifactId("us", CURRENT, CANDIDATE);
const REPORTED = calibrationComparisonBuildArtifactId(PAIR, "reported");
const SHARED = calibrationComparisonBuildArtifactId(PAIR, "shared");
const originalToken = process.env.BLOB_READ_WRITE_TOKEN;

afterEach(() => {
  if (originalToken == null) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
});

test("an uncached exact pair is built once and redirected to its immutable bundle", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
  const builds: unknown[] = [];
  const handler = createCalibrationComparisonTreeHandler({
    getBlob: (async () => null) as CalibrationComparisonTreeRouteDependencies["getBlob"],
    ensureComparison: (async (options) => {
      builds.push(options);
      return {
        pairArtifactId: PAIR,
        reportedBuildArtifactId: REPORTED,
        sharedBuildArtifactId: SHARED,
      };
    }) as CalibrationComparisonTreeRouteDependencies["ensureComparison"],
  });
  const response = await handler(new Request(
    `https://dashboard.example/api/microcosm/comparison-tree?country=us&a=${CURRENT}&b=${CANDIDATE}&mode=reported&part=index`,
  ));

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    `https://dashboard.example/calibration/dashboard/api/microcosm/comparison-tree?country=us&mode=reported&part=index&build=${REPORTED}`,
  );
  expect(builds).toEqual([{
    country: "us",
    currentBuildArtifactId: CURRENT,
    candidateBuildArtifactId: CANDIDATE,
    token: "blob-token",
  }]);
});

test("exact comparison bundle requests stream immutable private Blob parts", async () => {
  const body = '{"schemaVersion":5,"part":"tier-1"}\n';
  const requests: unknown[] = [];
  const handler = createCalibrationComparisonTreeHandler({
    ensureComparison: (async () => {
      throw new Error("unexpected");
    }) as CalibrationComparisonTreeRouteDependencies["ensureComparison"],
    getBlob: (async (options) => {
      requests.push(options);
      return {
        statusCode: 200 as const,
        stream: new Blob([body]).stream(),
        headers: new Headers(),
        blob: {
          url: "https://blob.example/tree.json",
          downloadUrl: "https://blob.example/tree.json?download=1",
          pathname: `calibration-trees/us/${REPORTED}/tier-1.json`,
          contentDisposition: "inline",
          cacheControl: "public, max-age=31536000",
          uploadedAt: new Date("2026-09-18T12:00:00.000Z"),
          etag: '"comparison-etag"',
          contentType: "application/json; charset=utf-8",
          size: body.length,
        },
      };
    }) as CalibrationComparisonTreeRouteDependencies["getBlob"],
  });
  const response = await handler(new Request(
    `https://dashboard.example/api/microcosm/comparison-tree?country=us&build=${REPORTED}&mode=reported&part=tier-1`,
  ));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe(body);
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(requests).toEqual([{
    country: "us",
    buildArtifactId: REPORTED,
    part: "tier-1",
    ifNoneMatch: undefined,
  }]);
});

test("comparison requests require exact source build ids", async () => {
  const handler = createCalibrationComparisonTreeHandler({
    getBlob: (async () => null) as CalibrationComparisonTreeRouteDependencies["getBlob"],
    ensureComparison: (async () => {
      throw new Error("unexpected");
    }) as CalibrationComparisonTreeRouteDependencies["ensureComparison"],
  });
  const response = await handler(new Request(
    "https://dashboard.example/api/microcosm/comparison-tree?country=us&a=latest&b=bad&mode=reported&part=index",
  ));
  expect(response.status).toBe(400);
});
