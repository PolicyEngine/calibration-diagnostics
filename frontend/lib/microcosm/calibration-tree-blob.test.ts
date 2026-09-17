import { expect, test } from "bun:test";

import { buildCalibrationTreeBundle } from "./calibration-tree-bundle";
import {
  deleteLegacyCalibrationTreeBlobs,
  listLegacyCalibrationTreeBlobs,
  readCalibrationTreeManifest,
  updateCalibrationTreeManifest,
  uploadCalibrationTreeBundle,
  type CalibrationTreeBlobClient,
} from "./calibration-tree-blob";

function memoryClient() {
  const content = new Map<string, string>();
  const etags = new Map<string, string>();
  const putCalls: Array<{ pathname: string; options: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  let version = 0;
  const client: CalibrationTreeBlobClient = {
    get: (async (pathname: string, options: { ifNoneMatch?: string }) => {
      const body = content.get(pathname);
      if (body == null) return null;
      const etag = etags.get(pathname)!;
      const metadata = {
        url: `https://blob.example/${pathname}`,
        downloadUrl: `https://blob.example/${pathname}?download=1`,
        pathname,
        contentDisposition: "inline",
        cacheControl: "public, max-age=60",
        uploadedAt: new Date("2026-09-15T12:00:00.000Z"),
        etag,
      };
      if (options.ifNoneMatch === etag) {
        return {
          statusCode: 304 as const,
          stream: null,
          headers: new Headers(),
          blob: { ...metadata, contentType: null, size: null },
        };
      }
      return {
        statusCode: 200 as const,
        stream: new Blob([body]).stream(),
        headers: new Headers(),
        blob: {
          ...metadata,
          contentType: "application/json; charset=utf-8",
          size: body.length,
        },
      };
    }) as CalibrationTreeBlobClient["get"],
    put: (async (
      pathname: string,
      body: string,
      options: Record<string, unknown>,
    ) => {
      putCalls.push({ pathname, options });
      const existingEtag = etags.get(pathname);
      if (existingEtag && options.ifMatch !== existingEtag) {
        throw new Error("precondition failed");
      }
      version += 1;
      const etag = `\"etag-${version}\"`;
      content.set(pathname, String(body));
      etags.set(pathname, etag);
      return {
        url: `https://blob.example/${pathname}`,
        downloadUrl: `https://blob.example/${pathname}?download=1`,
        pathname,
        contentType: "application/json; charset=utf-8",
        contentDisposition: "inline",
      };
    }) as unknown as CalibrationTreeBlobClient["put"],
    list: (async (options: { prefix?: string }) => ({
      blobs: [...content.keys()]
        .filter((pathname) => pathname.startsWith(options.prefix ?? ""))
        .map((pathname) => ({
          pathname,
          url: `https://blob.example/${pathname}`,
          downloadUrl: `https://blob.example/${pathname}?download=1`,
          size: content.get(pathname)!.length,
          uploadedAt: new Date(),
        })),
      hasMore: false,
    })) as CalibrationTreeBlobClient["list"],
    del: (async (paths: string[] | string) => {
      for (const pathname of Array.isArray(paths) ? paths : [paths]) {
        deleted.push(pathname);
        content.delete(pathname);
      }
    }) as CalibrationTreeBlobClient["del"],
  };
  return { client, content, putCalls, deleted };
}

function treeBundle() {
  return buildCalibrationTreeBundle({
    country: "us",
    releaseId: "microcosm-us-test",
    hfRepo: "policyengine/populace-us",
    hfCommitSha: "1234567890abcdef1234567890abcdef12345678",
    sourceArtifacts: {
      calibrationDiagnostics: {
        path: "releases/microcosm-us-test/calibration_diagnostics.json",
        sha256: "a".repeat(64),
      },
      buildManifest: null,
      releaseManifest: null,
      demographics: null,
    },
    rows: [{
      comparison_id: "target",
      name: "target",
      target_label: "Target",
      target_representation: "hierarchy",
      source: "chronicle",
      variable: "snap",
      geography: "United States",
      level: "national",
      abs_relative_error: 0.01,
      final_loss_contribution: 0.01,
      target_loss_weight_share: 1,
      calibration_status: "included",
      target_dimensions: [],
    }],
  });
}

test("bundle upload writes the index last, verifies every part, and is idempotent", async () => {
  const store = memoryClient();
  const bundle = treeBundle();
  const first = await uploadCalibrationTreeBundle({
    bundle,
    token: "publisher-token",
    client: store.client,
  });
  const second = await uploadCalibrationTreeBundle({
    bundle,
    token: "publisher-token",
    client: store.client,
  });
  expect(first.files.every((file) => file.created)).toBe(true);
  expect(second.files.every((file) => !file.created)).toBe(true);
  expect(store.putCalls.map((call) => call.pathname).at(-1)).toEndWith("/index.json");
  expect(store.putCalls[0].options).toMatchObject({
    access: "private",
    token: "publisher-token",
    addRandomSuffix: false,
    multipart: true,
  });

  store.content.set(first.files[0].pathname, "changed");
  await expect(uploadCalibrationTreeBundle({
    bundle,
    token: "publisher-token",
    client: store.client,
  })).rejects.toThrow("different content");
});

test("manifest writes merge countries and conditionally replace the prior version", async () => {
  const store = memoryClient();
  const baseEntry = {
    releaseId: "microcosm-test",
    hfCommitSha: "1234567890abcdef1234567890abcdef12345678",
    treeSchemaVersion: 2 as const,
    indexSha256: "b".repeat(64),
    indexBytes: 100,
    updatedAt: "2026-09-15T12:00:00.000Z",
  };
  await updateCalibrationTreeManifest({
    country: "us",
    entry: { ...baseEntry, releaseId: "microcosm-us-test" },
    token: "publisher-token",
    client: store.client,
  });
  await updateCalibrationTreeManifest({
    country: "uk",
    entry: { ...baseEntry, releaseId: "microcosm-uk-test" },
    token: "publisher-token",
    client: store.client,
  });
  const { manifest } = await readCalibrationTreeManifest({
    token: "publisher-token",
    consistent: true,
    client: store.client,
  });
  expect(manifest.countries.us?.releaseId).toBe("microcosm-us-test");
  expect(manifest.countries.uk?.releaseId).toBe("microcosm-uk-test");
  expect(store.putCalls[1].options.ifMatch).toBe('"etag-1"');
});

test("legacy cleanup lists and deletes only obsolete v1 paths", async () => {
  const store = memoryClient();
  store.content.set("calibration-trees/v1/us/old.json", "old");
  store.content.set("calibration-trees/latest.v1.json", "old manifest");
  store.content.set("calibration-trees/us/new/index.json", "new");
  const paths = await listLegacyCalibrationTreeBlobs({
    token: "publisher-token",
    client: store.client,
  });
  expect(paths).toEqual([
    "calibration-trees/latest.v1.json",
    "calibration-trees/v1/us/old.json",
  ]);
  await deleteLegacyCalibrationTreeBlobs({
    token: "publisher-token",
    paths,
    client: store.client,
  });
  expect(store.deleted).toEqual(paths);
  await expect(deleteLegacyCalibrationTreeBlobs({
    token: "publisher-token",
    paths: ["calibration-trees/us/new/index.json"],
    client: store.client,
  })).rejects.toThrow("Refusing");
});
