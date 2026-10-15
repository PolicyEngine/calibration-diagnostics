import { afterEach, expect, test } from "bun:test";

import recordedGoldens from "../packages/calibration-tree/src/fixtures/calibration-tree-golden.json";
import {
  emptyCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifestEntry,
} from "@policyengine/calibration-tree/calibration-tree-manifest";
import { COUNTRY_REGISTRY } from "@policyengine/calibration-tree/countries";
import {
  goldenReleaseInputs,
  withRegisteredRepositories,
  type CalibrationTreeGoldenRecord,
  type GoldenReleaseInput,
} from "../packages/calibration-tree/src/test-support/calibration-tree-golden-cases";
import {
  reconcileReleaseBuilds,
  type CalibrationManifestStore,
} from "./publish-calibration-tree";

// A repair rebuilds a published release whose index went missing and refuses
// any rebuilt index whose digest differs from the manifest entry. Seeding the
// entry with the recorded build id and index digest therefore proves, through
// the publisher's own Hugging Face reads and source hashing, that it rebuilds
// the recorded index byte for byte.
const recorded = recordedGoldens as CalibrationTreeGoldenRecord;
const MAIN_REVISION_SHA = "0123456789abcdef0123456789abcdef01234567";
// Generous, so the suite also passes on a heavily loaded machine.
const BUILD_TIMEOUT_MS = 300_000;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type ReleaseCaseName = keyof ReturnType<typeof goldenReleaseInputs>;

// The dataset repository as the publisher reads it: one tagged release at
// its commit, which `latest.json` on the main branch also names.
function huggingFaceReleaseRepository(release: GoldenReleaseInput): typeof fetch {
  const repo = COUNTRY_REGISTRY[release.country].repo;
  const api = `https://huggingface.co/api/datasets/${repo}`;
  const resolveUrl = (revision: string, path: string) =>
    `https://huggingface.co/datasets/${repo}/resolve/${revision}/${path}`;
  const prefix = `releases/${release.releaseId}`;
  const publishedFiles = new Map<string, string>([
    ["calibration_diagnostics.json", release.diagnosticsText],
    ...(release.releaseManifestText == null
      ? []
      : [["release_manifest.json", release.releaseManifestText] as [string, string]]),
  ]);
  const responses = new Map<string, () => Response>([
    [
      `${api}/tree/main/releases?recursive=true`,
      () => Response.json([...publishedFiles.keys()].map((name) => ({
        type: "file",
        path: `${prefix}/${name}`,
      }))),
    ],
    [
      `${api}/refs`,
      () => Response.json({
        tags: [{ name: release.releaseId, targetCommit: release.hfCommitSha }],
      }),
    ],
    [`${api}/revision/main`, () => Response.json({ sha: MAIN_REVISION_SHA })],
    [`${api}/revision/${release.releaseId}`, () => Response.json({ sha: release.hfCommitSha })],
    [
      resolveUrl(MAIN_REVISION_SHA, "latest.json"),
      () => Response.json({ release_id: release.releaseId }),
    ],
  ]);
  for (const [name, text] of publishedFiles) {
    responses.set(resolveUrl(release.hfCommitSha, `${prefix}/${name}`), () => new Response(text));
    responses.set(resolveUrl("main", `${prefix}/${name}`), () => new Response(text));
  }
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const respond = responses.get(url);
    if (respond) return respond();
    if (url.startsWith(resolveUrl(release.hfCommitSha, `${prefix}/`))) {
      return new Response(null, { status: 404 });
    }
    throw new Error(`Unexpected Hugging Face request ${url}`);
  }) as typeof fetch;
}

function recordedReleaseEntry(
  release: GoldenReleaseInput,
  name: ReleaseCaseName,
): CalibrationTreeManifestEntry {
  const record = recorded.sources[name];
  const index = record.files.find((file) => file.part === "index");
  if (!index) throw new Error(`The ${name} record has no index.`);
  return {
    buildArtifactId: record.buildArtifactId,
    kind: "release",
    sourceId: release.releaseId,
    label: release.releaseId,
    releaseId: release.releaseId,
    stagingRunId: null,
    hfRepo: COUNTRY_REGISTRY[release.country].repo,
    hfCommitSha: release.hfCommitSha,
    treeSchemaVersion: 6,
    indexSha256: index.sha256,
    indexBytes: index.rawBytes,
    createdAt: release.publishedAt,
    updatedAt: release.publishedAt,
  };
}

// A published release whose stored index has gone missing.
function storeMissingIndex(
  release: GoldenReleaseInput,
  entry: CalibrationTreeManifestEntry,
): CalibrationManifestStore {
  return {
    readManifest: async () => withCalibrationTreeManifestEntry(
      emptyCalibrationTreeManifest(),
      release.country,
      entry,
      true,
    ),
    listBlobs: async () => new Map(),
    audit: async () => ({
      complete: false,
      repairable: true,
      reasons: ["index is missing"],
      index: null,
    }),
    updateManifest: async () => {
      throw new Error("A dry run must not write the manifest.");
    },
  };
}

const RELEASE_DESCRIPTIONS: Record<"us-release" | "uk-release" | "be-release", string> = {
  "us-release": "US legacy",
  "uk-release": "UK hierarchy",
  "be-release": "Belgium",
};

for (const [name, description] of Object.entries(RELEASE_DESCRIPTIONS) as Array<
  [keyof typeof RELEASE_DESCRIPTIONS, string]
>) {
  test(
    `a dry-run repair of the recorded ${description} release rebuilds its recorded index`,
    async () => {
      const release = goldenReleaseInputs()[name];
      const entry = recordedReleaseEntry(release, name);
      globalThis.fetch = huggingFaceReleaseRepository(release);

      const report = await withRegisteredRepositories(() =>
        reconcileReleaseBuilds(release.country, "unused-blob-token", true, storeMissingIndex(release, entry))
      );

      expect(report.outcomes).toEqual([{
        sourceId: release.releaseId,
        status: "repaired",
        buildArtifactId: recorded.sources[name].buildArtifactId,
        reason: "Dry run; no Blob writes performed.",
      }]);
    },
    BUILD_TIMEOUT_MS,
  );
}

test("a repair refuses a rebuilt index that differs from the recorded digest", async () => {
  const release = goldenReleaseInputs()["uk-release"];
  const entry = { ...recordedReleaseEntry(release, "uk-release"), indexSha256: "0".repeat(64) };
  globalThis.fetch = huggingFaceReleaseRepository(release);

  await expect(withRegisteredRepositories(() =>
    reconcileReleaseBuilds(release.country, "unused-blob-token", true, storeMissingIndex(release, entry))
  )).rejects.toThrow("Rebuilt calibration index differs from immutable manifest entry");
});
