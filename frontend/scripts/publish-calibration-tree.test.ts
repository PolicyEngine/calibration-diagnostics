import { expect, test } from "bun:test";

import {
  CalibrationTreeArtifactSizeError,
  enforceConfiguredSizeLimits,
  parsePublisherOptions,
  reconcileReleaseBuilds,
  withPublicationTimestamp,
  readUpstreamLatest,
  resolvePublicationSourceSha,
  manifestBuildForSource,
} from "./publish-calibration-tree";
import {
  emptyCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifest,
  type CalibrationTreeManifestEntry,
} from "../lib/microcosm/calibration-tree-manifest";

const originalFetch = globalThis.fetch;

test("publisher accepts exact and historical reconciliation modes", () => {
  expect(parsePublisherOptions(["--country", "us", "--latest"])).toEqual({
    country: "us",
    mode: "latest",
  });
  expect(parsePublisherOptions([
    "--country",
    "uk",
    "--release",
    "microcosm-uk-20260915",
    "--sha",
    "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
  ])).toEqual({
    country: "uk",
    mode: "release",
    releaseId: "microcosm-uk-20260915",
    hfCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
  });
  expect(parsePublisherOptions(["--country", "be", "--backfill"])).toEqual({
    country: "be",
    mode: "backfill",
  });
  expect(parsePublisherOptions([
    "--country",
    "be",
    "--latest",
    "--sha",
    "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
  ])).toEqual({
    country: "be",
    mode: "latest",
    hfCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
  });
  expect(parsePublisherOptions([
    "--country",
    "uk",
    "--staging-finalized",
    "--sha",
    "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
  ])).toEqual({
    country: "uk",
    mode: "staging-finalized",
    hfCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
  });
  expect(parsePublisherOptions([
    "--country",
    "us",
    "--reconcile-releases",
    "--dry-run",
  ])).toEqual({
    country: "us",
    mode: "reconcile-releases",
    dryRun: true,
  });
  expect(parsePublisherOptions([
    "--country",
    "uk",
    "--reconcile-staging",
    "--sha",
    "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    "--dry-run",
  ])).toEqual({
    country: "uk",
    mode: "reconcile-staging",
    hfCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
    dryRun: true,
  });
});

test("publisher rejects ambiguous modes and unsafe release ids", () => {
  expect(() => parsePublisherOptions(["--latest", "--backfill"])).toThrow(
    "exactly one",
  );
  expect(() => parsePublisherOptions(["--release", "../latest"])).toThrow(
    "valid immutable release id",
  );
  expect(() => parsePublisherOptions(["--latest", "--dry-run"])).toThrow(
    "reconciliation modes",
  );
  expect(() => parsePublisherOptions([
    "--reconcile-releases",
    "--sha",
    "1".repeat(40),
  ])).toThrow("not valid for release-history reconciliation");
});

test("manifest lookup resolves one immutable source alias", () => {
  const manifest = emptyCalibrationTreeManifest();
  manifest.countries.us = {
    latestReleaseBuildArtifactId: null,
    builds: [{
      buildArtifactId: "a".repeat(64),
      kind: "staging",
      sourceId: "us-staging-run",
      label: "US staging run",
      releaseId: null,
      stagingRunId: "us-staging-run",
      hfRepo: "policyengine/populace-us-staging",
      hfCommitSha: "b".repeat(40),
      treeSchemaVersion: 6,
      indexSha256: "c".repeat(64),
      indexBytes: 100,
      createdAt: null,
      updatedAt: "2026-09-22T00:00:00.000Z",
    }],
  };
  expect(manifestBuildForSource(
    manifest,
    "us",
    "staging",
    "us-staging-run",
  )?.buildArtifactId).toBe("a".repeat(64));
  expect(manifestBuildForSource(
    manifest,
    "us",
    "release",
    "us-staging-run",
  )).toBeNull();
});

test("publisher enforces configured artifact size limits", () => {
  const previous = process.env.CALIBRATION_TREE_MAX_RAW_BYTES;
  process.env.CALIBRATION_TREE_MAX_RAW_BYTES = "10";
  try {
    expect(() => enforceConfiguredSizeLimits({
      part: "target-details-0001",
      path: `calibration-trees/us/${"a".repeat(64)}/target-details-0001.json.gz`,
      artifact: {} as never,
      serialized: "12345678901",
      compressed: new Uint8Array([1, 2, 3, 4, 5]),
      sha256: "a".repeat(64),
      rawBytes: 11,
      gzipBytes: 5,
    })).toThrow(
      CalibrationTreeArtifactSizeError,
    );
  } finally {
    if (previous == null) delete process.env.CALIBRATION_TREE_MAX_RAW_BYTES;
    else process.env.CALIBRATION_TREE_MAX_RAW_BYTES = previous;
  }
});

test("latest publication uses its exact source commit when no release tag exists", async () => {
  const sourceSha = "1".repeat(40);
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/revision/microcosm-be-current")) {
      return new Response(null, { status: 404 });
    }
    if (url.endsWith(`/${sourceSha}/latest.json`)) {
      return Response.json({
        release_id: "microcosm-be-current",
        updated_at: "2026-09-16T12:00:00Z",
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    await expect(readUpstreamLatest("be", sourceSha)).resolves.toEqual({
      releaseId: "microcosm-be-current",
      hfCommitSha: sourceSha,
      updatedAt: "2026-09-16T12:00:00Z",
    });
    expect(requested).toContain(
      `https://huggingface.co/datasets/policyengine/populace-be-private/resolve/${sourceSha}/latest.json`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an exact supplied commit supports a release without a matching tag", async () => {
  const sourceSha = "4".repeat(40);
  globalThis.fetch = (async (input: string | URL | Request) => {
    expect(String(input)).toContain("/revision/microcosm-us-untagged");
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    await expect(resolvePublicationSourceSha(
      "us",
      "microcosm-us-untagged",
      sourceSha,
      false,
    )).resolves.toBe(sourceSha);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a stored entry takes its pinned commit's publication timestamp, once", () => {
  const entry: CalibrationTreeManifestEntry = {
    buildArtifactId: "d".repeat(64),
    kind: "release",
    sourceId: "microcosm-uk-2024-25-national",
    label: "microcosm-uk-2024-25-national",
    releaseId: "microcosm-uk-2024-25-national",
    stagingRunId: null,
    hfRepo: "policyengine/populace-uk-private",
    hfCommitSha: "f".repeat(40),
    treeSchemaVersion: 6,
    indexSha256: "e".repeat(64),
    indexBytes: 10,
    createdAt: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
  const stamped = withPublicationTimestamp(entry, "2026-10-04T18:57:22.000Z");
  expect(stamped).toEqual({
    ...entry,
    createdAt: "2026-10-04T18:57:22.000Z",
    updatedAt: "2026-10-04T18:57:22.000Z",
  });
  expect(withPublicationTimestamp(stamped, "2026-10-04T18:57:22.000Z")).toBe(stamped);
});

test("reconciliation replaces a complete entry's epoch placeholder with the commit date", async () => {
  // The production symptom: the UK national release was published with an
  // entry whose bundle is complete but whose updatedAt is the 1970
  // placeholder. Reconciliation must rewrite the stored metadata from the
  // pinned commit's date without re-publishing the bundle.
  const repo = "policyengine/populace-uk-private";
  const releaseId = "microcosm-uk-2024-25-national";
  const sha = "f".repeat(40);
  const publishedAt = "2026-10-04T18:57:22.000Z";
  const stale: CalibrationTreeManifestEntry = {
    buildArtifactId: "d".repeat(64),
    kind: "release",
    sourceId: releaseId,
    label: releaseId,
    releaseId,
    stagingRunId: null,
    hfRepo: repo,
    hfCommitSha: sha,
    treeSchemaVersion: 6,
    indexSha256: "e".repeat(64),
    indexBytes: 10,
    createdAt: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
  let manifest: CalibrationTreeManifest = withCalibrationTreeManifestEntry(
    emptyCalibrationTreeManifest(),
    "uk",
    stale,
    true,
  );
  const writes: Array<{ entry: CalibrationTreeManifestEntry; makeLatest?: boolean }> = [];
  const store = {
    readManifest: async () => manifest,
    listBlobs: async () => new Map(),
    audit: async () => ({ complete: true, repairable: true, reasons: [], index: null }),
    updateManifest: async (entry: CalibrationTreeManifestEntry, makeLatest?: boolean) => {
      writes.push({ entry, makeLatest });
      manifest = withCalibrationTreeManifestEntry(manifest, "uk", entry, makeLatest);
      return manifest;
    },
  };
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes(`/api/datasets/${repo}/tree/main/releases?recursive=true`)) {
      return Response.json([
        { type: "file", path: `releases/${releaseId}/calibration_diagnostics.json` },
        { type: "file", path: `releases/${releaseId}/release_manifest.json` },
      ]);
    }
    if (url.includes(`/api/datasets/${repo}/refs`)) {
      return Response.json({ tags: [] });
    }
    if (url.includes(`/tree/main/releases/${releaseId}?recursive=false&expand=true`)) {
      return Response.json([
        {
          type: "file",
          path: `releases/${releaseId}/calibration_diagnostics.json`,
          lastCommit: { id: sha, date: publishedAt },
        },
        {
          type: "file",
          path: `releases/${releaseId}/release_manifest.json`,
          lastCommit: { id: sha, date: publishedAt },
        },
      ]);
    }
    if (url.includes(`/api/datasets/${repo}/commits/${sha}?limit=1`)) {
      return Response.json([{ id: sha, date: publishedAt, title: "Publish" }]);
    }
    if (url.includes(`/api/datasets/${repo}/revision/main`)) {
      return Response.json({ sha });
    }
    if (url.includes(`/api/datasets/${repo}/revision/${releaseId}`)) {
      return new Response(null, { status: 404 });
    }
    if (url.endsWith("/latest.json")) {
      return Response.json({ release_id: releaseId, updated_at: "2026-10-04T18:58:18+00:00" });
    }
    if (url.endsWith(`/releases/${releaseId}/release_manifest.json`)) {
      return Response.json({});
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    const outcome = report.outcomes.find((item) => item.sourceId === releaseId);
    expect(outcome?.status).toBe("repaired");
    expect(outcome?.reason).toContain(publishedAt);
    const stored = manifest.countries.uk?.builds.find(
      (build) => build.releaseId === releaseId,
    );
    expect(stored?.createdAt).toBe(publishedAt);
    expect(stored?.updatedAt).toBe(publishedAt);
    expect(stored?.hfCommitSha).toBe(sha);
    expect(stored?.indexSha256).toBe(stale.indexSha256);
    // The timestamp came from the commit log at the pinned revision, and the
    // bundle itself was not re-published.
    expect(requested.some((url) => url.includes(`/commits/${sha}?limit=1`))).toBe(true);
    expect(writes.map((write) => write.entry.updatedAt)).toEqual([publishedAt, publishedAt]);
    expect(writes[1]?.makeLatest).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
