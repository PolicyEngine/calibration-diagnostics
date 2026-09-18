import { expect, test } from "bun:test";

import {
  createCalibrationTreeHandler,
  type CalibrationTreeRouteDependencies,
} from "./route";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";
const BUILD = "a".repeat(64);

function resolver() {
  return (async () => ({
    buildArtifactId: BUILD,
    releaseId: "microcosm-us-release",
    hfCommitSha: COMMIT,
    updatedAt: "2026-09-15T12:00:00.000Z",
  })) as CalibrationTreeRouteDependencies["resolveRelease"];
}

test("release aliases redirect to an exact immutable artifact URL", async () => {
  let blobRead = false;
  const handler = createCalibrationTreeHandler({
    resolveRelease: resolver(),
    getBlob: (async () => {
      blobRead = true;
      return null;
    }) as CalibrationTreeRouteDependencies["getBlob"],
  });
  const response = await handler(
    new Request("https://dashboard.example/api/microcosm/tree?country=us&release=latest&part=index"),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    `https://dashboard.example/calibration/dashboard/api/microcosm/tree?country=us&part=index&build=${BUILD}`,
  );
  expect(response.headers.get("x-microcosm-release")).toBe("microcosm-us-release");
  expect(response.headers.get("vercel-cdn-cache-control")).toContain("max-age=60");
  expect(blobRead).toBe(false);
});

test("exact builds stream private Blob content through the same-origin API", async () => {
  const requests: unknown[] = [];
  let releaseResolved = false;
  const body = '{"schemaVersion":5,"part":"tier-1"}\n';
  const handler = createCalibrationTreeHandler({
    resolveRelease: (async () => {
      releaseResolved = true;
      throw new Error("unexpected");
    }) as CalibrationTreeRouteDependencies["resolveRelease"],
    getBlob: (async (options) => {
      requests.push(options);
      return {
        statusCode: 200 as const,
        stream: new Blob([body]).stream(),
        headers: new Headers(),
        blob: {
          url: "https://blob.example/tree.json",
          downloadUrl: "https://blob.example/tree.json?download=1",
          pathname: `calibration-trees/us/${BUILD}/tier-1.json`,
          contentDisposition: "inline",
          cacheControl: "public, max-age=31536000",
          uploadedAt: new Date("2026-09-15T12:00:00.000Z"),
          etag: '"tree-etag"',
          contentType: "application/json; charset=utf-8",
          size: body.length,
        },
      };
    }) as CalibrationTreeRouteDependencies["getBlob"],
  });
  const response = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=tier-1`,
    { headers: { "if-none-match": '"old"' } },
  ));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe(body);
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(response.headers.get("etag")).toBe('"tree-etag"');
  expect(releaseResolved).toBe(false);
  expect(requests).toEqual([{
    country: "us",
    buildArtifactId: BUILD,
    part: "tier-1",
    ifNoneMatch: '"old"',
  }]);
});

test("exact builds forward conditional requests and return 304", async () => {
  const handler = createCalibrationTreeHandler({
    resolveRelease: resolver(),
    getBlob: (async (options) => {
      expect(options.ifNoneMatch).toBe('"tree-etag"');
      return {
        statusCode: 304 as const,
        stream: null,
        headers: new Headers(),
        blob: {
          url: "https://blob.example/tree.json",
          downloadUrl: "https://blob.example/tree.json?download=1",
          pathname: `calibration-trees/us/${BUILD}/index.json`,
          contentDisposition: "inline",
          cacheControl: "public, max-age=31536000",
          uploadedAt: new Date("2026-09-15T12:00:00.000Z"),
          etag: '"tree-etag"',
          contentType: null,
          size: null,
        },
      };
    }) as CalibrationTreeRouteDependencies["getBlob"],
  });
  const response = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=index`,
    { headers: { "if-none-match": '"tree-etag"' } },
  ));

  expect(response.status).toBe(304);
  expect(response.headers.get("etag")).toBe('"tree-etag"');
  expect(await response.text()).toBe("");
});

test("tree API rejects ambiguous identities and reports unpublished builds", async () => {
  const handler = createCalibrationTreeHandler({
    resolveRelease: resolver(),
    getBlob: (async () => null) as CalibrationTreeRouteDependencies["getBlob"],
  });
  const ambiguous = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&release=x&build=${BUILD}&part=index`,
  ));
  expect(ambiguous.status).toBe(400);
  const missing = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=index`,
  ));
  expect(missing.status).toBe(404);
});

test("tree API requires an allowlisted part name", async () => {
  const parts: string[] = [];
  const handler = createCalibrationTreeHandler({
    resolveRelease: resolver(),
    getBlob: (async (options) => {
      parts.push(options.part);
      return null;
    }) as CalibrationTreeRouteDependencies["getBlob"],
  });
  const missing = await handler(new Request(
    "https://dashboard.example/api/microcosm/tree?country=us&release=latest",
  ));
  const unsafe = await handler(new Request(
    "https://dashboard.example/api/microcosm/tree?country=us&release=latest&part=../secret",
  ));
  const monolith = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=target-details`,
  ));
  const oldIndex = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=target-index`,
  ));
  const zero = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=target-details-0000`,
  ));
  const zeroSummary = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=target-summary-0000`,
  ));
  const filterIndex = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=filter-index`,
  ));
  const validSummary = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=target-summary-0001`,
  ));
  const validShard = await handler(new Request(
    `https://dashboard.example/api/microcosm/tree?country=us&build=${BUILD}&part=target-details-0001`,
  ));
  expect(missing.status).toBe(400);
  expect(unsafe.status).toBe(400);
  expect(monolith.status).toBe(400);
  expect(oldIndex.status).toBe(400);
  expect(zero.status).toBe(400);
  expect(zeroSummary.status).toBe(400);
  expect(filterIndex.status).toBe(404);
  expect(validSummary.status).toBe(404);
  expect(validShard.status).toBe(404);
  expect(parts).toEqual([
    "filter-index",
    "target-summary-0001",
    "target-details-0001",
  ]);
});
