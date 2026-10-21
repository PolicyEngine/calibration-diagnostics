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
  runPublisher,
} from "./publish-calibration-tree";
import {
  emptyCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifest,
  type CalibrationTreeManifestEntry,
} from "./calibration-tree-manifest";
import type { CalibrationTreeBundle } from "./calibration-tree-bundle";
import { schema9Diagnostics } from "./test-support/schema-9-diagnostics";

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
      releaseDirectory: "microcosm-be-current",
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
// A repository the entry recorded at publication that is not the one the
// country currently configures: the migration must read the entry's own.
const RECORDED_REPO = "policyengine/populace-uk-archive";
const UK_RELEASE = "microcosm-uk-2024-25-national";
const UK_SHA = "f".repeat(40);
const UK_PUBLISHED_AT = "2026-10-04T18:57:22.000Z";

/** The production entry: a complete bundle whose metadata carries the placeholder. */
function placeholderEntry(hfRepo = UK_REPO): CalibrationTreeManifestEntry {
  return {
    buildArtifactId: "d".repeat(64),
    kind: "release",
    sourceId: UK_RELEASE,
    label: UK_RELEASE,
    releaseId: UK_RELEASE,
    stagingRunId: null,
    hfRepo,
    hfCommitSha: UK_SHA,
    treeSchemaVersion: 6,
    indexSha256: "e".repeat(64),
    indexBytes: 10,
    createdAt: null,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

/**
 * A manifest and Blob store in memory. It records each upload, listing, audit
 * and manifest write in the order the publisher makes them. Every audit
 * reports a complete build, except for the release IDs in
 * `incompleteAfterUpload`, whose uploaded build audits as missing a file.
 */
function memoryStore(
  initial: CalibrationTreeManifest,
  options: { incompleteAfterUpload?: ReadonlySet<string> } = {},
) {
  let manifest = initial;
  const writes: Array<{ entry: CalibrationTreeManifestEntry; makeLatest?: boolean }> = [];
  const uploads: CalibrationTreeBundle[] = [];
  const operations: string[] = [];
  return {
    writes,
    uploads,
    operations,
    current: () => manifest,
    readManifest: async () => manifest,
    listBlobs: async () => {
      operations.push("list files");
      return new Map();
    },
    audit: async (entry: CalibrationTreeManifestEntry) => {
      operations.push(`audit ${entry.releaseId}`);
      return entry.releaseId && options.incompleteAfterUpload?.has(entry.releaseId)
        ? {
            complete: false,
            repairable: true,
            reasons: [`missing calibration-trees/uk/${entry.buildArtifactId}/tier-1.json.gz`],
            index: null,
          }
        : { complete: true, repairable: true, reasons: [], index: null };
    },
    updateManifest: async (entry: CalibrationTreeManifestEntry, makeLatest?: boolean) => {
      operations.push(`write ${entry.releaseId}${makeLatest ? " as latest" : ""}`);
      writes.push({ entry, makeLatest });
      manifest = withCalibrationTreeManifestEntry(manifest, "uk", entry, makeLatest);
      return manifest;
    },
    uploadBundle: async (bundle: CalibrationTreeBundle) => {
      operations.push(`upload ${bundle.index.build.releaseId}`);
      uploads.push(bundle);
      const stored = (file: CalibrationTreeBundle["files"][number]) => ({
        pathname: file.path,
        sha256: file.sha256,
        bytes: file.rawBytes,
        created: true,
      });
      return {
        files: bundle.files.map(stored),
        index: stored(bundle.files.find((file) => file.part === "index")!),
      };
    },
  };
}

test("the timestamp migration sets a legacy entry's updatedAt from its own commit", async () => {
  // Starts from a complete manifest entry carrying the epoch placeholder,
  // runs the migration, and checks the stored entry receives the canonical
  // publication timestamp: the date of the commit the entry already pins.
  const stale = placeholderEntry(RECORDED_REPO);
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
    // Only the recorded repository knows the commit; the country's current
    // repository would answer 404, as it would for an entry published under
    // an earlier configuration.
    if (url === `https://huggingface.co/api/datasets/${RECORDED_REPO}/commits/${UK_SHA}?limit=1`) {
      return Response.json([{ id: UK_SHA, date: UK_PUBLISHED_AT, title: "Publish" }]);
    }
    if (url.includes(`/api/datasets/${UK_REPO}/commits/`)) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    const planned = await migrateReleaseTimestamps("uk", "blob-token", true, store);
    expect(planned.outcomes).toEqual([
      {
        buildArtifactId: stale.buildArtifactId,
        releaseId: UK_RELEASE,
        hfRepo: RECORDED_REPO,
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
    // Only the entry's own commit, in the entry's own repository, was read,
    // once per run.
    expect(requested).toEqual([
      `https://huggingface.co/api/datasets/${RECORDED_REPO}/commits/${UK_SHA}?limit=1`,
      `https://huggingface.co/api/datasets/${RECORDED_REPO}/commits/${UK_SHA}?limit=1`,
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
  // The UK pointer must name a tag, so the latest release is a published
  // tag of the same folder, pinned at the stale entry's commit.
  const currentTag = `${UK_RELEASE}-20261004T185722Z-0f0f0f0f`;
  const current: CalibrationTreeManifestEntry = {
    ...placeholderEntry(),
    buildArtifactId: "c".repeat(64),
    sourceId: currentTag,
    label: currentTag,
    releaseId: currentTag,
    releaseDirectory: UK_RELEASE,
    createdAt: UK_PUBLISHED_AT,
    updatedAt: UK_PUBLISHED_AT,
  };
  const store = memoryStore(
    withCalibrationTreeManifestEntry(
      withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", stale, true),
      "uk",
      current,
    ),
  );
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(`/api/datasets/${UK_REPO}/tree/main/releases?recursive=true`)) {
      return Response.json([
        { type: "file", path: `releases/${UK_RELEASE}/calibration_diagnostics.json` },
        { type: "file", path: `releases/${UK_RELEASE}/release_manifest.json` },
      ]);
    }
    if (url.includes(`/api/datasets/${UK_REPO}/refs`)) {
      return Response.json({ tags: [{ name: currentTag, targetCommit: UK_SHA }] });
    }
    if (url.includes(`/api/datasets/${UK_REPO}/revision/${currentTag}`)) {
      return Response.json({ sha: UK_SHA });
    }
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
    if (url.endsWith("/latest-national.json")) {
      return Response.json({
        schema_version: 1,
        release_id: UK_RELEASE,
        line: "national",
        revision: currentTag,
      });
    }
    if (url.endsWith(`/releases/${UK_RELEASE}/release_manifest.json`)) return Response.json({});
    // No commit-log lookup belongs here; reconciliation does not date entries.
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    expect(report.outcomes.find((item) => item.sourceId === UK_RELEASE)?.status).toBe("complete");
    expect(report.outcomes.find((item) => item.sourceId === currentTag)?.status).toBe("complete");
    expect(store.current().countries.uk?.builds).toHaveLength(2);
    expect(store.current().countries.uk?.builds).toContainEqual(stale);
    expect(store.current().countries.uk?.builds).toContainEqual(current);
    expect(store.writes.map((write) => [write.entry.releaseId, write.makeLatest]))
      .toEqual([[currentTag, true]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// A Microcosm line (microcosm#823): one constant folder, one immutable tag per
// cut. All values are synthetic.
const NATIONAL_LINE = "microcosm-uk-2024-25-national";
const DENSE_LINE = "microcosm-uk-2024-25-dense";
const NATIONAL_CUT = `${NATIONAL_LINE}-20261019T083323Z-0a1b2c3d`;
const DENSE_CUT = `${DENSE_LINE}-20261019T000432Z-4e5f6a7b`;
// A cut-shaped tag whose folder names another cut: never published.
const STRAY_CUT = `${NATIONAL_LINE}-20261001T000000Z-99999999`;
const JUNE_RELEASE = "populace-uk-2023-test-20260619T023711Z";
const NATIONAL_SHA = "1".repeat(40);
const DENSE_SHA = "2".repeat(40);
const STRAY_SHA = "3".repeat(40);
const JUNE_SHA = "4".repeat(40);
const MAIN_SHA = "5".repeat(40);
const COMMIT_DATES: Record<string, string> = {
  [NATIONAL_SHA]: "2026-10-19T10:21:22.000Z",
  [DENSE_SHA]: "2026-10-19T07:53:18.000Z",
};

const SCHEMA_8_DIAGNOSTICS = {
  schema_version: 8,
  targets: [{
    name: "provider.target@2025",
    target_name: "provider.target",
    source: "Citation",
    target: 100,
    initial_estimate: 90,
    final_estimate: 100,
    hierarchy: {
      provider: { id: "provider", label: "Provider label" },
      category: { id: "provider.category", label: "Category label", provider_id: "provider" },
      geography: { id: "K02000001", label: "United Kingdom", level: "country" },
      dimensions: [],
      target: { id: "provider.target", label: "Target label" },
    },
  }],
};

function juneEntry(): CalibrationTreeManifestEntry {
  return {
    ...placeholderEntry(),
    buildArtifactId: "a".repeat(64),
    sourceId: JUNE_RELEASE,
    label: JUNE_RELEASE,
    releaseId: JUNE_RELEASE,
    hfCommitSha: JUNE_SHA,
    createdAt: "2026-06-19T02:38:38.000Z",
    updatedAt: "2026-06-19T02:38:38.000Z",
  };
}

function lineRepositoryFetch(
  requested: string[],
  diagnosticsFor: (directory: string) => Record<string, unknown> = () => SCHEMA_8_DIAGNOSTICS,
) {
  const api = `https://huggingface.co/api/datasets/${UK_REPO}`;
  const resolve = `https://huggingface.co/datasets/${UK_REPO}/resolve`;
  const folderListing = (directory: string) => Response.json([
    { type: "file", path: `releases/${directory}/calibration_diagnostics.json` },
    { type: "file", path: `releases/${directory}/release_manifest.json` },
  ]);
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url === `${api}/tree/main/releases?recursive=true`) {
      return Response.json([
        { type: "file", path: `releases/${NATIONAL_LINE}/calibration_diagnostics.json` },
        { type: "file", path: `releases/${JUNE_RELEASE}/calibration_diagnostics.json` },
      ]);
    }
    if (url === `${api}/refs`) {
      return Response.json({
        branches: [{ name: "main", targetCommit: MAIN_SHA }],
        tags: [
          { name: NATIONAL_CUT, targetCommit: NATIONAL_SHA },
          { name: DENSE_CUT, targetCommit: DENSE_SHA },
          { name: STRAY_CUT, targetCommit: STRAY_SHA },
          { name: JUNE_RELEASE, targetCommit: JUNE_SHA },
        ],
      });
    }
    // No cut has a folder of its own; each keeps its files in its line's.
    for (const [sha, tag] of [[NATIONAL_SHA, NATIONAL_CUT], [DENSE_SHA, DENSE_CUT], [STRAY_SHA, STRAY_CUT]]) {
      if (url === `${api}/tree/${sha}/releases/${tag}?recursive=false`) {
        return new Response(null, { status: 404 });
      }
    }
    if (url === `${api}/tree/${NATIONAL_SHA}/releases/${NATIONAL_LINE}?recursive=false`) return folderListing(NATIONAL_LINE);
    if (url === `${api}/tree/${STRAY_SHA}/releases/${NATIONAL_LINE}?recursive=false`) return folderListing(NATIONAL_LINE);
    if (url === `${api}/tree/${DENSE_SHA}/releases/${DENSE_LINE}?recursive=false`) return folderListing(DENSE_LINE);
    if (url === `${resolve}/${NATIONAL_SHA}/releases/${NATIONAL_LINE}/release_manifest.json`) {
      return Response.json({ build: { cut_tag: NATIONAL_CUT }, default_datasets: { national: "x.h5" } });
    }
    if (url === `${resolve}/${STRAY_SHA}/releases/${NATIONAL_LINE}/release_manifest.json`) {
      return Response.json({ build: { cut_tag: NATIONAL_CUT } });
    }
    if (url === `${resolve}/${DENSE_SHA}/releases/${DENSE_LINE}/release_manifest.json`) {
      return Response.json({
        build: { cut_tag: DENSE_CUT },
        dataset_role: "non_default_local_area",
        is_default: false,
      });
    }
    if (url === `${resolve}/${NATIONAL_SHA}/releases/${NATIONAL_LINE}/calibration_diagnostics.json`) {
      return Response.json(diagnosticsFor(NATIONAL_LINE));
    }
    if (url === `${resolve}/${DENSE_SHA}/releases/${DENSE_LINE}/calibration_diagnostics.json`) {
      return Response.json(diagnosticsFor(DENSE_LINE));
    }
    if (/\/releases\/[^/]+\/(build_manifest|demographics)\.json$/.test(url)) {
      return new Response(null, { status: 404 });
    }
    const commit = /\/commits\/([0-9a-f]{40})\?limit=1$/.exec(url)?.[1];
    if (commit && COMMIT_DATES[commit]) {
      return Response.json([{ id: commit, date: COMMIT_DATES[commit] }]);
    }
    if (url === `${api}/revision/main`) return Response.json({ sha: MAIN_SHA });
    if (url === `${api}/revision/${NATIONAL_CUT}`) return Response.json({ sha: NATIONAL_SHA });
    if (url === `${resolve}/${MAIN_SHA}/latest-national.json`) {
      return Response.json({
        schema_version: 1,
        release_id: NATIONAL_LINE,
        updated_at: "2026-10-19T10:21:51+00:00",
        line: "national",
        revision: NATIONAL_CUT,
        paths: {},
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
}

test("release reconciliation publishes each line cut from its folder and follows the line pointer", async () => {
  // The folder's build from before cuts were recognised, and the June
  // release, which is latest until the line pointer is read.
  const legacy = placeholderEntry();
  const june = juneEntry();
  const store = memoryStore(
    withCalibrationTreeManifestEntry(
      withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", legacy),
      "uk",
      june,
      true,
    ),
  );
  const requested: string[] = [];
  globalThis.fetch = lineRepositoryFetch(requested);
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    const status = Object.fromEntries(
      report.outcomes.map((outcome) => [outcome.sourceId, outcome.status]),
    );
    expect(status).toEqual({
      [NATIONAL_CUT]: "published",
      [DENSE_CUT]: "published",
      [STRAY_CUT]: "ineligible",
      [NATIONAL_LINE]: "complete",
      [JUNE_RELEASE]: "complete",
    });
    expect(report.outcomes.find((outcome) => outcome.sourceId === STRAY_CUT)?.reason)
      .toContain("does not name it as its cut");

    const builds = store.current().countries.uk!.builds;
    const national = builds.find((build) => build.releaseId === NATIONAL_CUT)!;
    const dense = builds.find((build) => build.releaseId === DENSE_CUT)!;
    expect(national).toMatchObject({
      sourceId: NATIONAL_CUT,
      releaseDirectory: NATIONAL_LINE,
      hfCommitSha: NATIONAL_SHA,
      createdAt: COMMIT_DATES[NATIONAL_SHA],
      updatedAt: COMMIT_DATES[NATIONAL_SHA],
    });
    expect(dense).toMatchObject({
      sourceId: DENSE_CUT,
      releaseDirectory: DENSE_LINE,
      hfCommitSha: DENSE_SHA,
      createdAt: COMMIT_DATES[DENSE_SHA],
    });
    // The folder build and the June build are untouched; the line pointer's
    // cut becomes the latest release.
    expect(builds.find((build) => build.releaseId === NATIONAL_LINE)).toEqual(legacy);
    expect(builds.find((build) => build.releaseId === JUNE_RELEASE)).toEqual(june);
    expect(store.current().countries.uk!.latestReleaseBuildArtifactId)
      .toBe(national.buildArtifactId);
    expect(store.uploads.map((bundle) => bundle.index.build.releaseId).sort())
      .toEqual([DENSE_CUT, NATIONAL_CUT]);

    // Files are read from the line folder at each cut's own commit; the line
    // folder on main is never dated, and the frozen latest.json is never read.
    expect(requested).toContain(
      `https://huggingface.co/datasets/${UK_REPO}/resolve/${DENSE_SHA}/releases/${DENSE_LINE}/calibration_diagnostics.json`,
    );
    expect(requested.some((url) => url.includes("expand=true"))).toBe(false);
    expect(requested.some((url) => url.endsWith("/latest.json"))).toBe(false);

    // A second run finds every build complete and does not probe the
    // published cuts again.
    requested.length = 0;
    const again = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    expect(again.outcomes.filter((outcome) => outcome.status !== "ineligible")
      .every((outcome) => outcome.status === "complete")).toBe(true);
    expect(store.uploads).toHaveLength(2);
    expect(requested.some((url) => url.includes(`/tree/${NATIONAL_SHA}/`))).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// A file the schema 8 reader refuses: its second row puts the first row's
// category under another provider. A release built from it cannot be
// published.
const REFUSED_SCHEMA_8_DIAGNOSTICS = {
  schema_version: 8,
  targets: [
    SCHEMA_8_DIAGNOSTICS.targets[0],
    {
      ...SCHEMA_8_DIAGNOSTICS.targets[0],
      name: "other.target@2025",
      target_name: "other.target",
      hierarchy: {
        ...SCHEMA_8_DIAGNOSTICS.targets[0].hierarchy,
        provider: { id: "other", label: "Other provider" },
        category: { id: "provider.category", label: "Category label", provider_id: "other" },
        target: { id: "other.target", label: "Other target label" },
      },
    },
  ],
};
const REFUSED_SCHEMA_8_ERROR =
  "Schema 8 category provider.category references inconsistent providers: provider and other.";

function lineStoreWithJuneLatest(
  options: { incompleteAfterUpload?: ReadonlySet<string> } = {},
) {
  return memoryStore(
    withCalibrationTreeManifestEntry(
      withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", placeholderEntry()),
      "uk",
      juneEntry(),
      true,
    ),
    options,
  );
}

test("release reconciliation records a release it cannot build as failed and still publishes the releases after it", async () => {
  // The dense cut sorts first, so on its own it used to stop reconciliation
  // before the national cut and the latest-release selection.
  const store = lineStoreWithJuneLatest();
  globalThis.fetch = lineRepositoryFetch([], (directory) =>
    directory === DENSE_LINE ? REFUSED_SCHEMA_8_DIAGNOSTICS : SCHEMA_8_DIAGNOSTICS
  );
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    const status = Object.fromEntries(
      report.outcomes.map((outcome) => [outcome.sourceId, outcome.status]),
    );
    expect(status).toEqual({
      [DENSE_CUT]: "failed",
      [NATIONAL_CUT]: "published",
      [STRAY_CUT]: "ineligible",
      [NATIONAL_LINE]: "complete",
      [JUNE_RELEASE]: "complete",
    });
    expect(report.outcomes.find((outcome) => outcome.sourceId === DENSE_CUT)).toEqual({
      sourceId: DENSE_CUT,
      status: "failed",
      buildArtifactId: null,
      reason: REFUSED_SCHEMA_8_ERROR,
    });
    expect(report.latestReleaseFailure).toBeUndefined();

    // Nothing is uploaded or written for the failed cut. The national cut is
    // published and becomes the latest release, as its line pointer says.
    expect(store.uploads.map((bundle) => bundle.index.build.releaseId)).toEqual([NATIONAL_CUT]);
    expect(store.writes.map((write) => [write.entry.releaseId, write.makeLatest ?? false]))
      .toEqual([[NATIONAL_CUT, false], [NATIONAL_CUT, true]]);
    const builds = store.current().countries.uk!.builds;
    expect(builds.map((build) => build.releaseId).sort())
      .toEqual([JUNE_RELEASE, NATIONAL_LINE, NATIONAL_CUT].sort());
    expect(store.current().countries.uk!.latestReleaseBuildArtifactId)
      .toBe(builds.find((build) => build.releaseId === NATIONAL_CUT)!.buildArtifactId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a release whose uploaded build fails its audit gets no manifest entry, and the releases after it are still published", async () => {
  const store = lineStoreWithJuneLatest({ incompleteAfterUpload: new Set([DENSE_CUT]) });
  globalThis.fetch = lineRepositoryFetch([]);
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    const dense = report.outcomes.find((outcome) => outcome.sourceId === DENSE_CUT);
    expect(dense?.status).toBe("failed");
    expect(dense?.buildArtifactId).toBeNull();
    expect(dense?.reason).toMatch(
      new RegExp(`^Release build ${DENSE_CUT} remains incomplete: missing calibration-trees/uk/[0-9a-f]{64}/tier-1\\.json\\.gz$`),
    );
    expect(report.outcomes.find((outcome) => outcome.sourceId === NATIONAL_CUT)?.status)
      .toBe("published");

    // Each uploaded build is audited before the manifest names it, so the
    // dense cut's files are never registered.
    expect(store.operations).toEqual([
      "list files",
      `upload ${DENSE_CUT}`,
      "list files",
      `audit ${DENSE_CUT}`,
      `audit ${NATIONAL_LINE}`,
      `upload ${NATIONAL_CUT}`,
      "list files",
      `audit ${NATIONAL_CUT}`,
      `write ${NATIONAL_CUT}`,
      `audit ${JUNE_RELEASE}`,
      `write ${NATIONAL_CUT} as latest`,
    ]);
    expect(store.current().countries.uk!.builds.some((build) => build.releaseId === DENSE_CUT))
      .toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("when the release the line pointer names fails, the latest-release selection is left as it was", async () => {
  const store = lineStoreWithJuneLatest();
  globalThis.fetch = lineRepositoryFetch([], (directory) =>
    directory === NATIONAL_LINE ? REFUSED_SCHEMA_8_DIAGNOSTICS : SCHEMA_8_DIAGNOSTICS
  );
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, store);
    expect(report.outcomes.find((outcome) => outcome.sourceId === NATIONAL_CUT)).toEqual({
      sourceId: NATIONAL_CUT,
      status: "failed",
      buildArtifactId: null,
      reason: REFUSED_SCHEMA_8_ERROR,
    });
    expect(report.outcomes.find((outcome) => outcome.sourceId === DENSE_CUT)?.status)
      .toBe("published");
    expect(report.latestReleaseFailure).toBe(
      `Latest release ${NATIONAL_CUT} failed to reconcile, so the latest-release selection was not changed.`,
    );

    // Only the dense cut is written; the June release stays the latest.
    expect(store.writes.map((write) => [write.entry.releaseId, write.makeLatest ?? false]))
      .toEqual([[DENSE_CUT, false]]);
    expect(store.current().countries.uk!.latestReleaseBuildArtifactId)
      .toBe(juneEntry().buildArtifactId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the publisher prints every release outcome, then exits with an error naming each failed release", async () => {
  // Two failures: the dense cut's file is refused, and the June release's
  // stored build pins a commit its tag no longer points at.
  const movedJune = { ...juneEntry(), hfCommitSha: "6".repeat(40) };
  const store = memoryStore(
    withCalibrationTreeManifestEntry(
      withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", placeholderEntry()),
      "uk",
      movedJune,
      true,
    ),
  );
  globalThis.fetch = lineRepositoryFetch([], (directory) =>
    directory === DENSE_LINE ? REFUSED_SCHEMA_8_DIAGNOSTICS : SCHEMA_8_DIAGNOSTICS
  );
  const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "unused-blob-token";
  const printed: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    printed.push(String(message));
  };
  try {
    await expect(
      runPublisher({ country: "uk", mode: "reconcile-releases" }, { store }),
    ).rejects.toThrow(
      `2 of 5 releases failed to reconcile: ${DENSE_CUT}, ${JUNE_RELEASE}. ` +
        "The printed report gives each reason.",
    );
    expect(printed).toHaveLength(1);
    const report = JSON.parse(printed[0]) as { outcomes: Array<{ sourceId: string; status: string; reason: string | null }> };
    expect(report.outcomes.map((outcome) => [outcome.sourceId, outcome.status])).toEqual([
      [STRAY_CUT, "ineligible"],
      [DENSE_CUT, "failed"],
      [NATIONAL_LINE, "complete"],
      [NATIONAL_CUT, "published"],
      [JUNE_RELEASE, "failed"],
    ]);
    expect(report.outcomes.find((outcome) => outcome.sourceId === JUNE_RELEASE)?.reason).toBe(
      `Released dataset ${JUNE_RELEASE} changed from ${"6".repeat(40)} to ${JUNE_SHA}.`,
    );
    // The national cut still becomes the latest release.
    expect(store.writes.map((write) => [write.entry.releaseId, write.makeLatest ?? false]))
      .toEqual([[NATIONAL_CUT, false], [NATIONAL_CUT, true]]);
  } finally {
    console.log = originalLog;
    globalThis.fetch = originalFetch;
    if (originalBlobToken == null) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  }
});

test("a dry run records a failed release, writes nothing and still reports the releases after it", async () => {
  const store = lineStoreWithJuneLatest();
  globalThis.fetch = lineRepositoryFetch([], (directory) =>
    directory === DENSE_LINE ? REFUSED_SCHEMA_8_DIAGNOSTICS : SCHEMA_8_DIAGNOSTICS
  );
  try {
    const report = await reconcileReleaseBuilds("uk", "blob-token", true, store);
    expect(report.dryRun).toBe(true);
    expect(report.outcomes.find((outcome) => outcome.sourceId === DENSE_CUT)?.status)
      .toBe("failed");
    expect(report.outcomes.find((outcome) => outcome.sourceId === NATIONAL_CUT)).toMatchObject({
      status: "published",
      reason: "Dry run; no Blob writes performed.",
    });
    expect(store.uploads).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("release reconciliation publishes a schema 9 release with the tree of its schema 8 equivalent", async () => {
  const schema8Store = lineStoreWithJuneLatest();
  const schema9Store = lineStoreWithJuneLatest();
  try {
    globalThis.fetch = lineRepositoryFetch([]);
    await reconcileReleaseBuilds("uk", "blob-token", false, schema8Store);
    globalThis.fetch = lineRepositoryFetch([], () => schema9Diagnostics(SCHEMA_8_DIAGNOSTICS));
    const report = await reconcileReleaseBuilds("uk", "blob-token", false, schema9Store);

    expect(report.outcomes.filter((outcome) => outcome.status === "published")
      .map((outcome) => outcome.sourceId).sort()).toEqual([DENSE_CUT, NATIONAL_CUT].sort());
    // The source digest, and so the build ID, comes from the file's bytes.
    // With both replaced, every uploaded file is the same as for schema 8,
    // except that the index records each part's SHA-256 and compressed size,
    // which cover the build ID inside the part; those two fields are left out.
    const withoutIdentity = (bundle: CalibrationTreeBundle) =>
      bundle.files.map((file) => {
        const text = file.serialized
          .replaceAll(bundle.index.buildArtifactId, "<build>")
          .replaceAll(bundle.index.build.sourceArtifacts.calibrationDiagnostics?.sha256 ?? "", "<digest>");
        if (file.part !== "index") return text;
        return JSON.stringify(JSON.parse(text), (key, value) =>
          key === "sha256" || key === "gzipBytes" ? undefined : value
        );
      });
    expect(schema9Store.uploads.map(withoutIdentity))
      .toEqual(schema8Store.uploads.map(withoutIdentity));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the UK latest release is the cut its line pointer names", async () => {
  const requested: string[] = [];
  globalThis.fetch = lineRepositoryFetch(requested);
  try {
    await expect(readUpstreamLatest("uk")).resolves.toEqual({
      releaseId: NATIONAL_CUT,
      releaseDirectory: NATIONAL_LINE,
      hfCommitSha: NATIONAL_SHA,
      updatedAt: "2026-10-19T10:21:51+00:00",
    });
    expect(requested.some((url) => url.endsWith("/latest.json"))).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a line pointer must name an existing cut of its own release", async () => {
  const pointer = (revision: string) => (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/revision/main")) return Response.json({ sha: MAIN_SHA });
    if (url.endsWith(`/${MAIN_SHA}/latest-national.json`)) {
      return Response.json({
        schema_version: 1,
        release_id: NATIONAL_LINE,
        line: "national",
        revision,
      });
    }
    if (url.includes("/revision/")) return new Response(null, { status: 404 });
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    globalThis.fetch = pointer(DENSE_CUT);
    await expect(readUpstreamLatest("uk")).rejects.toThrow("not a cut of");
    globalThis.fetch = pointer(NATIONAL_CUT);
    await expect(readUpstreamLatest("uk")).rejects.toThrow("was not found");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Codex review of #223: --latest published whatever tag the pointer named.
// The pointer's tag must pass the check reconciliation applies: the release
// manifest at that tag names the tag in build.cut_tag.
test("the latest publication refuses a pointer tag whose release manifest names another build", async () => {
  const api = `https://huggingface.co/api/datasets/${UK_REPO}`;
  const resolve = `https://huggingface.co/datasets/${UK_REPO}/resolve`;
  const requested: string[] = [];
  const repository = lineRepositoryFetch(requested);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === `${resolve}/${MAIN_SHA}/latest-national.json`) {
      requested.push(url);
      return Response.json({
        schema_version: 1,
        release_id: NATIONAL_LINE,
        line: "national",
        revision: STRAY_CUT,
      });
    }
    if (url === `${api}/revision/${STRAY_CUT}`) {
      requested.push(url);
      return Response.json({ sha: STRAY_SHA });
    }
    return repository(input);
  }) as typeof fetch;
  const priorBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
  try {
    await expect(readUpstreamLatest("uk")).rejects.toThrow("does not name it as its cut");
    await expect(runPublisher({ country: "uk", mode: "latest" }))
      .rejects.toThrow("does not name it as its cut");
    // Refused before any calibration file was read or any Blob was written.
    expect(requested.some((url) => url.endsWith("/calibration_diagnostics.json"))).toBe(false);
    expect(requested.some((url) => !url.startsWith("https://huggingface.co/"))).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorBlobToken == null) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = priorBlobToken;
  }
});

// Codex review of #223: without `revision`, latest-national.json skipped
// every check. The UK registration names that pointer file, so its rules
// apply to whatever it contains.
function nationalPointerFetch(pointer: Record<string, unknown>) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/revision/main")) return Response.json({ sha: MAIN_SHA });
    if (url.endsWith(`/${MAIN_SHA}/latest-national.json`)) return Response.json(pointer);
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
}

test("a national pointer without a revision still has its schema version and release name checked", async () => {
  try {
    globalThis.fetch = nationalPointerFetch({
      schema_version: 99,
      line: "dense",
      release_id: NATIONAL_LINE,
    });
    await expect(readUpstreamLatest("uk")).rejects.toThrow("unsupported schema_version 99");
    globalThis.fetch = nationalPointerFetch({
      schema_version: 1,
      line: "dense",
      release_id: NATIONAL_LINE,
    });
    await expect(readUpstreamLatest("uk")).rejects.toThrow("declares line dense");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a national pointer that names no revision is refused", async () => {
  globalThis.fetch = nationalPointerFetch({
    schema_version: 1,
    line: "national",
    release_id: NATIONAL_LINE,
  });
  try {
    await expect(readUpstreamLatest("uk")).rejects.toThrow("names no revision");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Codex review of #223: Microcosm's diagnostics name the folder, so a tag's
// comparison metadata carried the folder name and two builds of one release
// compared as the same release.
test("a published tag's comparison metadata names the tag, as its build does", async () => {
  const store = memoryStore(
    withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", juneEntry(), true),
  );
  globalThis.fetch = lineRepositoryFetch([], (directory) => ({
    ...SCHEMA_8_DIAGNOSTICS,
    release_id: directory,
  }));
  try {
    await reconcileReleaseBuilds("uk", "blob-token", false, store);
    const identities = store.uploads
      .map((bundle) => [bundle.index.build.releaseId, bundle.index.targetComparison.releaseId])
      .sort();
    expect(identities).toEqual([
      [DENSE_CUT, DENSE_CUT],
      [NATIONAL_CUT, NATIONAL_CUT],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
