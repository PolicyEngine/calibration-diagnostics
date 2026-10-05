import { expect, test } from "bun:test";

import {
  CalibrationTreeArtifactSizeError,
  enforceConfiguredSizeLimits,
  parsePublisherOptions,
  migrateReleaseTimestamps,
  reconcileReleaseBuilds,
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
  expect(parsePublisherOptions([
    "--country",
    "uk",
    "--migrate-release-timestamps",
    "--dry-run",
  ])).toEqual({
    country: "uk",
    mode: "migrate-release-timestamps",
    dryRun: true,
  });
  expect(() => parsePublisherOptions([
    "--migrate-release-timestamps",
    "--sha",
    "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
  ])).toThrow("reads each entry's own commit");
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

const UK_REPO = "policyengine/populace-uk-private";
const UK_RELEASE = "microcosm-uk-2024-25-national";
const UK_SHA = "f".repeat(40);
const UK_PUBLISHED_AT = "2026-10-04T18:57:22.000Z";

/** The production entry: a complete bundle whose metadata carries the placeholder. */
function placeholderEntry(): CalibrationTreeManifestEntry {
  return {
    buildArtifactId: "d".repeat(64),
    kind: "release",
    sourceId: UK_RELEASE,
    label: UK_RELEASE,
    releaseId: UK_RELEASE,
    stagingRunId: null,
    hfRepo: UK_REPO,
    hfCommitSha: UK_SHA,
    treeSchemaVersion: 6,
    indexSha256: "e".repeat(64),
    indexBytes: 10,
    createdAt: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

function memoryStore(initial: CalibrationTreeManifest) {
  let manifest = initial;
  const writes: Array<{ entry: CalibrationTreeManifestEntry; makeLatest?: boolean }> = [];
  return {
    writes,
    current: () => manifest,
    readManifest: async () => manifest,
    listBlobs: async () => new Map(),
    audit: async () => ({ complete: true, repairable: true, reasons: [], index: null }),
    updateManifest: async (entry: CalibrationTreeManifestEntry, makeLatest?: boolean) => {
      writes.push({ entry, makeLatest });
      manifest = withCalibrationTreeManifestEntry(manifest, "uk", entry, makeLatest);
      return manifest;
    },
  };
}

test("the timestamp migration sets a legacy entry's updatedAt from its own commit", async () => {
  // Starts from a complete manifest entry carrying the epoch placeholder,
  // runs the migration, and checks the stored entry receives the canonical
  // publication timestamp: the date of the commit the entry already pins.
  const stale = placeholderEntry();
  const staging: CalibrationTreeManifestEntry = {
    ...stale,
    buildArtifactId: "9".repeat(64),
    kind: "staging",
    sourceId: "uk-frs-calibration-attempt-test",
    label: "candidate",
    releaseId: null,
    stagingRunId: "uk-frs-calibration-attempt-test",
    hfCommitSha: "8".repeat(40),
    createdAt: "2026-10-02T23:15:56.000Z",
    updatedAt: "2026-10-02T23:15:56.000Z",
  };
  const store = memoryStore(
    withCalibrationTreeManifestEntry(
      withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", stale, true),
      "uk",
      staging,
    ),
  );
  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url === `https://huggingface.co/api/datasets/${UK_REPO}/commits/${UK_SHA}?limit=1`) {
      return Response.json([{ id: UK_SHA, date: UK_PUBLISHED_AT, title: "Publish" }]);
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    const planned = await migrateReleaseTimestamps("uk", "blob-token", true, store);
    expect(planned.outcomes).toEqual([
      {
        buildArtifactId: stale.buildArtifactId,
        releaseId: UK_RELEASE,
        hfCommitSha: UK_SHA,
        from: "1970-01-01T00:00:00.000Z",
        to: UK_PUBLISHED_AT,
        status: "planned",
      },
    ]);
    expect(store.writes).toHaveLength(0);

    const migrated = await migrateReleaseTimestamps("uk", "blob-token", false, store);
    expect(migrated.outcomes[0]?.status).toBe("migrated");
    const stored = store.current().countries.uk?.builds.find(
      (build) => build.releaseId === UK_RELEASE,
    );
    // Only updatedAt moves: createdAt stays as the immutable index sealed it.
    expect(stored).toEqual({ ...stale, updatedAt: UK_PUBLISHED_AT });
    expect(store.current().countries.uk?.latestReleaseBuildArtifactId).toBe(
      stale.buildArtifactId,
    );
    expect(store.current().countries.uk?.builds.find((build) => build.kind === "staging"))
      .toEqual(staging);
    // Only the entry's own commit was read, once per run.
    expect(requested).toEqual([
      `https://huggingface.co/api/datasets/${UK_REPO}/commits/${UK_SHA}?limit=1`,
      `https://huggingface.co/api/datasets/${UK_REPO}/commits/${UK_SHA}?limit=1`,
    ]);

    const again = await migrateReleaseTimestamps("uk", "blob-token", false, store);
    expect(again.outcomes[0]?.status).toBe("current");
    expect(store.writes).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("release reconciliation leaves a complete entry's metadata to the migration", async () => {
  const stale = placeholderEntry();
  const store = memoryStore(
    withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", stale, true),
  );
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(`/api/datasets/${UK_REPO}/tree/main/releases?recursive=true`)) {
      return Response.json([
        { type: "file", path: `releases/${UK_RELEASE}/calibration_diagnostics.json` },
        { type: "file", path: `releases/${UK_RELEASE}/release_manifest.json` },
      ]);
    }
    if (url.includes(`/api/datasets/${UK_REPO}/refs`)) return Response.json({ tags: [] });
    if (url.includes(`/tree/main/releases/${UK_RELEASE}?recursive=false&expand=true`)) {
      return Response.json([
        {
          type: "file",
          path: `releases/${UK_RELEASE}/calibration_diagnostics.json`,
          lastCommit: { id: UK_SHA, date: UK_PUBLISHED_AT },
        },
      ]);
    }
    if (url.includes(`/api/datasets/${UK_REPO}/revision/main`)) return Response.json({ sha: UK_SHA });
    if (url.includes(`/api/datasets/${UK_REPO}/revision/${UK_RELEASE}`)) {
      return new Response(null, { status: 404 });
    }
    if (url.endsWith("/latest.json")) return Response.json({ release_id: UK_RELEASE });
    if (url.endsWith(`/releases/${UK_RELEASE}/release_manifest.json`)) return Response.json({});
    // No commit-log lookup belongs here; reconciliation does not date entries.
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    expect(report.outcomes.find((item) => item.sourceId === UK_RELEASE)?.status).toBe("complete");
    expect(store.current().countries.uk?.builds).toEqual([stale]);
    expect(store.writes.map((write) => write.makeLatest)).toEqual([true]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
