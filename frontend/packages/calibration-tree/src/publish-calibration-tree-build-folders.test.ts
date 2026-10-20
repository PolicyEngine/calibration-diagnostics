import { afterEach, expect, test } from "bun:test";

import {
  migrateReleaseTimestamps,
  parsePublisherOptions,
  readRecordedCurrentBuild,
  reconcileReleaseBuilds,
  runPublisher,
} from "./publish-calibration-tree";
import {
  emptyCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifest,
  type CalibrationTreeManifestEntry,
} from "./calibration-tree-manifest";
import type { CalibrationTreeBundle } from "./calibration-tree-bundle";

// A dataset repository that publishes each build in its own folder,
// releases/<release>/<build>/, with releases.json as the only record of
// which build is current (microcosm-emitter#24). Microcosm's migration (P1)
// writes this layout; nothing does yet, so every value here is synthetic.
const UK_REPO = "policyengine/populace-uk-private";
const API = `https://huggingface.co/api/datasets/${UK_REPO}`;
const RESOLVE = `https://huggingface.co/datasets/${UK_REPO}/resolve`;
const NATIONAL = "microcosm-uk-2024-25-national";
const DENSE = "microcosm-uk-2024-25-dense";
const NATIONAL_OLDER = "uk-frs-calibration-attempt-20261014T214443Z-d12ff9b3";
const NATIONAL_CURRENT = "uk-frs-calibration-attempt-20261019T083323Z-6cba5d71";
const DENSE_BUILD = "uk-local-candidate-f100-s42-20261019T000432Z-ee5c2dbe";
// Listed, but its folder's release manifest names another build.
const MISLABELLED_BUILD = "uk-frs-calibration-attempt-20261001T000000Z-99999999";
// Listed, but its folder holds no calibration diagnostics.
const UNCALIBRATED_BUILD = "uk-frs-calibration-attempt-20261002T000000Z-88888888";
const MAIN_SHA = "5".repeat(40);

const folder = (release: string, build: string) => `${release}/${build}`;

// The commit that wrote each build folder. The migration copies builds that
// were published earlier, so a folder's commit date is not when its build
// was published; releases.json records that.
const FOLDER_COMMITS: Record<string, { sha: string; date: string }> = {
  [folder(NATIONAL, NATIONAL_OLDER)]: { sha: "1".repeat(40), date: "2026-10-25T09:00:00.000Z" },
  [folder(NATIONAL, NATIONAL_CURRENT)]: { sha: "2".repeat(40), date: "2026-10-25T09:00:00.000Z" },
  [folder(DENSE, DENSE_BUILD)]: { sha: "3".repeat(40), date: "2026-10-25T09:05:00.000Z" },
  [folder(NATIONAL, MISLABELLED_BUILD)]: { sha: "4".repeat(40), date: "2026-10-25T09:00:00.000Z" },
  [folder(NATIONAL, UNCALIBRATED_BUILD)]: { sha: "6".repeat(40), date: "2026-10-25T09:00:00.000Z" },
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

function releasesRecord(): Record<string, unknown> {
  const build = (publishedAt: string) => ({ published_at: publishedAt, withdrawn: false });
  return {
    schema_version: 1,
    default: NATIONAL,
    releases: {
      [NATIONAL]: {
        role: "national_default",
        current: NATIONAL_CURRENT,
        builds: {
          [NATIONAL_OLDER]: build("2026-10-14T21:44:43+00:00"),
          [NATIONAL_CURRENT]: build("2026-10-19T08:33:23+00:00"),
          [MISLABELLED_BUILD]: build("2026-10-01T00:00:00+00:00"),
          [UNCALIBRATED_BUILD]: build("2026-10-02T00:00:00+00:00"),
        },
      },
      [DENSE]: {
        role: "non_default_local_area",
        current: null,
        builds: { [DENSE_BUILD]: build("2026-10-19T07:53:18+00:00") },
      },
    },
  };
}

interface RepositoryOptions {
  record?: Record<string, unknown>;
  diagnosticsFor?: (folderId: string) => Record<string, unknown>;
}

function buildFolderRepository(requested: string[], options: RepositoryOptions = {}) {
  const record = options.record ?? releasesRecord();
  const diagnosticsFor = options.diagnosticsFor ?? (() => SCHEMA_8_DIAGNOSTICS);
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url === `${API}/revision/main`) return Response.json({ sha: MAIN_SHA });
    if (url === `${RESOLVE}/${MAIN_SHA}/releases.json`) return Response.json(record);
    for (const [folderId, commit] of Object.entries(FOLDER_COMMITS)) {
      const [release, build] = folderId.split("/");
      const prefix = `releases/${folderId}`;
      if (url === `${API}/tree/${MAIN_SHA}/releases/${release}/${build}?recursive=false&expand=true`) {
        const names = build === UNCALIBRATED_BUILD
          ? ["release_manifest.json", "microcosm_uk_2024_25.h5"]
          : ["release_manifest.json", "calibration_diagnostics.json", "microcosm_uk_2024_25.h5"];
        return Response.json(names.map((name) => ({
          type: "file",
          path: `${prefix}/${name}`,
          lastCommit: { id: commit.sha, date: commit.date },
        })));
      }
      if (url === `${RESOLVE}/${commit.sha}/${prefix}/release_manifest.json`) {
        return Response.json({
          release,
          build: build === MISLABELLED_BUILD ? NATIONAL_CURRENT : build,
          artifacts: {},
        });
      }
      if (url === `${RESOLVE}/${commit.sha}/${prefix}/calibration_diagnostics.json`) {
        return Response.json(diagnosticsFor(folderId));
      }
      if (
        url === `${RESOLVE}/${commit.sha}/${prefix}/build_manifest.json` ||
        url === `${RESOLVE}/${commit.sha}/${prefix}/demographics.json`
      ) {
        return new Response(null, { status: 404 });
      }
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
}

function memoryStore(initial: CalibrationTreeManifest) {
  let manifest = initial;
  const uploads: CalibrationTreeBundle[] = [];
  const writes: Array<{ entry: CalibrationTreeManifestEntry; makeLatest?: boolean }> = [];
  return {
    uploads,
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
    uploadBundle: async (bundle: CalibrationTreeBundle) => {
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

// Entries the publisher wrote before the build folders: a release folder's
// build and a tagged build of the national release, read from its folder.
const TAGGED_BUILD = `${NATIONAL}-20261019T083323Z-6cba5d71`;
function earlierEntries(): CalibrationTreeManifestEntry[] {
  const entry = (
    digit: string,
    releaseId: string,
    releaseDirectory?: string,
  ): CalibrationTreeManifestEntry => ({
    buildArtifactId: digit.repeat(64),
    kind: "release",
    sourceId: releaseId,
    label: releaseId,
    releaseId,
    ...(releaseDirectory ? { releaseDirectory } : {}),
    stagingRunId: null,
    hfRepo: UK_REPO,
    hfCommitSha: digit.repeat(40),
    treeSchemaVersion: 6,
    indexSha256: "e".repeat(64),
    indexBytes: 10,
    createdAt: "2026-10-19T10:21:22.000Z",
    updatedAt: "2026-10-19T10:21:22.000Z",
  });
  return [entry("a", "populace-uk-2023-test-20260619T023711Z"), entry("b", TAGGED_BUILD, NATIONAL)];
}

function manifestWithEarlierEntries(): CalibrationTreeManifest {
  const [june, tagged] = earlierEntries();
  return withCalibrationTreeManifestEntry(
    withCalibrationTreeManifestEntry(emptyCalibrationTreeManifest(), "uk", june),
    "uk",
    tagged,
    true,
  );
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("release reconciliation publishes every build releases.json lists, from its own folder at the commit that wrote it", async () => {
  const store = memoryStore(emptyCalibrationTreeManifest());
  const requested: string[] = [];
  globalThis.fetch = buildFolderRepository(requested);

  const report = await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");

  expect(Object.fromEntries(report.outcomes.map((outcome) => [outcome.sourceId, outcome.status])))
    .toEqual({
      [folder(DENSE, DENSE_BUILD)]: "published",
      [folder(NATIONAL, NATIONAL_OLDER)]: "published",
      [folder(NATIONAL, NATIONAL_CURRENT)]: "published",
      [folder(NATIONAL, MISLABELLED_BUILD)]: "ineligible",
      [folder(NATIONAL, UNCALIBRATED_BUILD)]: "ineligible",
    });
  const current = store.current().countries.uk!.builds
    .find((build) => build.releaseId === folder(NATIONAL, NATIONAL_CURRENT))!;
  // The build's folder is its release id; there is no separate directory.
  expect(current).toMatchObject({
    sourceId: folder(NATIONAL, NATIONAL_CURRENT),
    label: folder(NATIONAL, NATIONAL_CURRENT),
    hfCommitSha: FOLDER_COMMITS[folder(NATIONAL, NATIONAL_CURRENT)].sha,
  });
  expect(current.releaseDirectory).toBeUndefined();
  expect(requested).toContain(
    `${RESOLVE}/${FOLDER_COMMITS[folder(DENSE, DENSE_BUILD)].sha}/releases/${DENSE}/${DENSE_BUILD}/calibration_diagnostics.json`,
  );
});

test("a build is dated by the publication time releases.json records, not by the commit that wrote its folder", async () => {
  const store = memoryStore(emptyCalibrationTreeManifest());
  globalThis.fetch = buildFolderRepository([]);

  await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");

  const older = store.current().countries.uk!.builds
    .find((build) => build.releaseId === folder(NATIONAL, NATIONAL_OLDER))!;
  expect(older.createdAt).toBe("2026-10-14T21:44:43.000Z");
  expect(older.updatedAt).toBe("2026-10-14T21:44:43.000Z");
});

test("the latest release becomes the current build of the record's default release", async () => {
  const store = memoryStore(manifestWithEarlierEntries());
  globalThis.fetch = buildFolderRepository([]);

  await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");

  const manifest = store.current().countries.uk!;
  const current = manifest.builds.find(
    (build) => build.releaseId === folder(NATIONAL, NATIONAL_CURRENT),
  )!;
  expect(manifest.latestReleaseBuildArtifactId).toBe(current.buildArtifactId);
});

test("reconciliation reads nothing but releases.json and the build folders it lists", async () => {
  const requested: string[] = [];
  globalThis.fetch = buildFolderRepository(requested);

  await reconcileReleaseBuilds(
    "uk",
    "blob-token",
    false,
    memoryStore(emptyCalibrationTreeManifest()),
    "build_folders",
  );

  // No tag list, no pointer file, no listing of releases/ itself.
  expect(requested.some((url) => url === `${API}/refs`)).toBe(false);
  expect(requested.some((url) => /\/latest[^/]*\.json$/.test(url))).toBe(false);
  expect(requested.some((url) => url.includes("/tree/main/releases"))).toBe(false);
  for (const url of requested) {
    expect(
      url === `${API}/revision/main` ||
        url === `${RESOLVE}/${MAIN_SHA}/releases.json` ||
        /\/releases\/[^/]+\/[^/?]+(\/[^/]+)?(\?recursive=false&expand=true)?$/.test(url) ||
        /\/commits\//.test(url),
      url,
    ).toBe(true);
  }
});

test("entries published before the build folders stay in the dashboard manifest unchanged", async () => {
  const store = memoryStore(manifestWithEarlierEntries());
  globalThis.fetch = buildFolderRepository([]);

  const report = await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");

  const builds = store.current().countries.uk!.builds;
  for (const earlier of earlierEntries()) {
    expect(builds.find((build) => build.buildArtifactId === earlier.buildArtifactId)).toEqual(earlier);
    expect(report.outcomes.some((outcome) => outcome.sourceId === earlier.releaseId)).toBe(false);
  }
});

test("a second reconciliation finds every listed build complete without listing their folders again", async () => {
  const store = memoryStore(emptyCalibrationTreeManifest());
  globalThis.fetch = buildFolderRepository([]);
  await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");

  const requested: string[] = [];
  globalThis.fetch = buildFolderRepository(requested);
  const again = await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");

  expect(again.outcomes.filter((outcome) => outcome.status !== "ineligible")
    .every((outcome) => outcome.status === "complete")).toBe(true);
  expect(store.uploads).toHaveLength(3);
  for (const published of [NATIONAL_OLDER, NATIONAL_CURRENT]) {
    expect(requested.some((url) => url.includes(`/releases/${NATIONAL}/${published}?`))).toBe(false);
  }
});

test("a listed build is not published when its folder has no calibration diagnostics or its release manifest names another build", async () => {
  globalThis.fetch = buildFolderRepository([]);

  const report = await reconcileReleaseBuilds(
    "uk",
    "blob-token",
    false,
    memoryStore(emptyCalibrationTreeManifest()),
    "build_folders",
  );

  const reason = (build: string) =>
    report.outcomes.find((outcome) => outcome.sourceId === folder(NATIONAL, build))?.reason ?? "";
  expect(reason(UNCALIBRATED_BUILD)).toContain("calibration diagnostics");
  expect(reason(MISLABELLED_BUILD)).toContain(
    `does not name release ${NATIONAL} and build ${MISLABELLED_BUILD}`,
  );
});

test("a build's comparison metadata names the build, not the release its diagnostics name", async () => {
  const store = memoryStore(emptyCalibrationTreeManifest());
  globalThis.fetch = buildFolderRepository([], {
    diagnosticsFor: (folderId) => ({ ...SCHEMA_8_DIAGNOSTICS, release_id: folderId.split("/")[0] }),
  });

  await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");

  expect(store.uploads).toHaveLength(3);
  for (const bundle of store.uploads) {
    expect(bundle.index.build.releaseId).not.toBeNull();
    expect(bundle.index.targetComparison.releaseId).toBe(bundle.index.build.releaseId ?? "");
  }
});

test("reconciliation refuses a releases.json the release writer would refuse, before publishing anything", async () => {
  const record = releasesRecord();
  const national = (record.releases as Record<string, Record<string, unknown>>)[NATIONAL];
  (national.builds as Record<string, Record<string, unknown>>)[NATIONAL_CURRENT].withdrawn = true;
  const store = memoryStore(emptyCalibrationTreeManifest());
  globalThis.fetch = buildFolderRepository([], { record });

  await expect(reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders"))
    .rejects.toThrow("is withdrawn");
  expect(store.uploads).toHaveLength(0);
  expect(store.writes).toHaveLength(0);
});

test("without a current build of the default release, reconciliation publishes the listed builds and fails without moving the latest release", async () => {
  const record = releasesRecord();
  (record.releases as Record<string, Record<string, unknown>>)[NATIONAL].current = null;
  const store = memoryStore(manifestWithEarlierEntries());
  const latestBefore = store.current().countries.uk!.latestReleaseBuildArtifactId;
  globalThis.fetch = buildFolderRepository([], { record });

  await expect(reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders"))
    .rejects.toThrow("names no current build of its default release");
  expect(store.uploads).toHaveLength(3);
  expect(store.current().countries.uk!.latestReleaseBuildArtifactId).toBe(latestBefore);
});

test("the current build is read from releases.json at the given commit and pinned to the commit that wrote its folder", async () => {
  const requested: string[] = [];
  globalThis.fetch = buildFolderRepository(requested);

  await expect(readRecordedCurrentBuild("uk", MAIN_SHA)).resolves.toEqual({
    releaseId: folder(NATIONAL, NATIONAL_CURRENT),
    releaseDirectory: folder(NATIONAL, NATIONAL_CURRENT),
    hfCommitSha: FOLDER_COMMITS[folder(NATIONAL, NATIONAL_CURRENT)].sha,
    publishedAt: "2026-10-19T08:33:23.000Z",
  });
  expect(requested).not.toContain(`${API}/revision/main`);
});

test("the publisher takes a build folder as the release to publish", () => {
  expect(parsePublisherOptions([
    "--country",
    "uk",
    "--release",
    folder(NATIONAL, NATIONAL_CURRENT),
  ])).toEqual({
    country: "uk",
    mode: "release",
    releaseId: folder(NATIONAL, NATIONAL_CURRENT),
  });
  for (const value of [`${NATIONAL}/${NATIONAL_CURRENT}/extra`, `${NATIONAL}/..`, `../${NATIONAL}`]) {
    expect(() => parsePublisherOptions(["--release", value]), value).toThrow(
      "valid immutable release id",
    );
  }
});

async function withBlobToken<T>(run: () => Promise<T>): Promise<T> {
  const priorBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
  try {
    return await run();
  } finally {
    if (priorBlobToken == null) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = priorBlobToken;
  }
}

test("a single-build publication refuses a build releases.json does not list, before reading any build file", async () => {
  const requested: string[] = [];
  globalThis.fetch = buildFolderRepository(requested);

  await withBlobToken(async () => {
    await expect(runPublisher(
      { country: "uk", mode: "release", releaseId: folder(NATIONAL, "uk-frs-calibration-attempt-unlisted") },
      "build_folders",
    )).rejects.toThrow("does not list build");
  });
  expect(requested.some((url) => url.includes("/tree/"))).toBe(false);
});

test("a single-build publication names a build folder only where the country publishes build folders", async () => {
  const requested: string[] = [];
  globalThis.fetch = buildFolderRepository(requested);

  await withBlobToken(async () => {
    await expect(runPublisher(
      { country: "uk", mode: "release", releaseId: folder(NATIONAL, NATIONAL_CURRENT) },
      "release_folders",
    )).rejects.toThrow("publishes release folders");
    await expect(runPublisher(
      { country: "uk", mode: "release", releaseId: TAGGED_BUILD },
      "build_folders",
    )).rejects.toThrow("publishes build folders");
  });
  expect(requested).toEqual([]);
});

test("the timestamp migration leaves build-folder entries dated as releases.json dated them", async () => {
  const store = memoryStore(emptyCalibrationTreeManifest());
  globalThis.fetch = buildFolderRepository([]);
  await reconcileReleaseBuilds("uk", "blob-token", false, store, "build_folders");
  const writesBefore = store.writes.length;

  const requested: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    requested.push(String(input));
    throw new Error(`Unexpected URL ${String(input)}`);
  }) as typeof fetch;
  const report = await migrateReleaseTimestamps("uk", "blob-token", false, store);

  expect(report.outcomes).toEqual([]);
  expect(requested).toEqual([]);
  expect(store.writes).toHaveLength(writesBefore);
});
