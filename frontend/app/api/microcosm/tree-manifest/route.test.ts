import { expect, test } from "bun:test";

import { emptyCalibrationTreeManifest, withCalibrationTreeManifestEntry } from "@/lib/microcosm/calibration-tree-manifest";
import { createCalibrationTreeManifestHandler } from "./route";

test("manifest API returns one country's current immutable release identity", async () => {
  const latest = {
    releaseId: "microcosm-us-release",
    hfCommitSha: "1234567890abcdef1234567890abcdef12345678",
    treeSchemaVersion: 2 as const,
    indexSha256: "a".repeat(64),
    indexBytes: 1234,
    updatedAt: "2026-09-15T12:00:00.000Z",
  };
  const manifest = withCalibrationTreeManifestEntry(
    emptyCalibrationTreeManifest(),
    "us",
    latest,
  );
  const handler = createCalibrationTreeManifestHandler({
    readManifest: async () => ({ manifest, etag: '"manifest"' }),
  });
  const response = await handler(new Request(
    "https://dashboard.example/api/microcosm/tree-manifest?country=us",
  ));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ schemaVersion: 2, country: "us", latest });
  expect(response.headers.get("vercel-cdn-cache-control")).toContain("max-age=60");
});

test("manifest API rejects unselectable countries", async () => {
  let read = false;
  const handler = createCalibrationTreeManifestHandler({
    readManifest: async () => {
      read = true;
      return { manifest: emptyCalibrationTreeManifest(), etag: null };
    },
  });
  const response = await handler(new Request(
    "https://dashboard.example/api/microcosm/tree-manifest?country=zz",
  ));
  expect(response.status).toBe(400);
  expect(read).toBe(false);
});
