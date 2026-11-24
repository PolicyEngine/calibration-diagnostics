// Test support: the collector's calibration tree store, in memory.
// `install()` puts its `get` in place of `collectorStoreBlob.get`, the one
// Blob client the dashboard's store readers use, so the routes' real readers
// run against the objects added here: the tree manifest, each build's
// original-file copies, each country's `releases.json` copy and each
// country's staging run copies. It also replaces `globalThis.fetch`, which
// the Hugging Face readers use: every request to Hugging Face is recorded and
// answered 500, so a test can say that a page made none; any other request
// goes to the fetch `install` is given, such as a fake telemetry collector's,
// or fails the test. The Blob credentials are removed meanwhile, so a
// read that bypassed the client fails without leaving the machine.
import { spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { collectorStoreBlob } from "@/lib/microcosm/collector-store";

import { CALIBRATION_TREE_SCHEMA_VERSION } from "@policyengine/calibration-tree/calibration-tree-artifact";
import {
  emptyCalibrationTreeManifest,
  withCalibrationTreeManifestEntry,
  type CalibrationTreeManifest,
  type CalibrationTreeManifestEntry,
} from "@policyengine/calibration-tree/calibration-tree-manifest";
import {
  storedReleasesRecordDocument,
  storedReleasesRecordPath,
} from "@policyengine/calibration-tree/calibration-tree-releases-record";
import {
  calibrationTreeSourceFilePath,
  type CalibrationTreeSourceFile,
} from "@policyengine/calibration-tree/calibration-tree-source-files";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";
import {
  STAGING_RUN_FILES_SCHEMA_VERSION,
  stagingRunFilePath,
  stagingRunFilesIndexPath,
  type StagingRunFileName,
  type StagingRunFileRecord,
  type StagingRunFilesIndex,
} from "@policyengine/calibration-tree/staging-run-files";
import {
  summaryFromManifest,
  summaryFromProgress,
} from "@policyengine/calibration-tree/staging-artifact";

const MANIFEST_PATH = "calibration-trees/manifest.json";
const HUGGING_FACE_HOST = "huggingface.co";
// The Blob credentials `@vercel/blob` would otherwise prefer to the token.
const CREDENTIAL_SETTINGS = ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN"] as const;

type Document = string | Record<string, unknown>;

function bytesOf(document: Document): Uint8Array {
  return new TextEncoder().encode(
    typeof document === "string" ? document : JSON.stringify(document),
  );
}

/** The SHA-256 the store records for a document added here: of its JSON text. */
export function fakeDocumentSha256(document: Document): string {
  return sha256(bytesOf(document));
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A build ID or file digest named after a label, so tests can predict it. */
export function fakeBuildId(label: string): string {
  return sha256(`build:${label}`);
}

/** A Hugging Face commit named after a label. */
export function fakeCommit(label: string): string {
  return sha256(`commit:${label}`).slice(0, 40);
}

export interface FakeBuild {
  country: MicrocosmCountry;
  kind: "release" | "staging";
  /** The release ID of a release build; ignored for a staging build. */
  releaseId?: string;
  releaseDirectory?: string;
  /** The run of a staging build. */
  stagingRunId?: string;
  label?: string;
  hfRepo?: string;
  updatedAt?: string | null;
  latest?: boolean;
  /** A staging build that takes the place of the run's earlier tree. */
  replaceStagingRun?: boolean;
  /** Names the build apart from another of the same run. */
  variant?: string;
  /** The build's original files, by the name the store keeps them under. */
  files: Partial<Record<CalibrationTreeSourceFile, Document>>;
}

export interface FakeStagingRun {
  country: MicrocosmCountry;
  runId: string;
  files: Partial<Record<StagingRunFileName, Document>>;
  removed?: boolean;
  problem?: string | null;
}

export class FakeCollectorStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly requests: string[] = [];
  /** Set to make every read fail, as an unreachable store does. */
  failure: Error | null = null;
  private otherRequests: typeof fetch | null = null;
  readonly huggingFaceRequests: string[] = [];
  manifest: CalibrationTreeManifest = emptyCalibrationTreeManifest();
  private readonly stagingIndexes = new Map<MicrocosmCountry, StagingRunFilesIndex>();

  /** Adds a build to the tree manifest and stores its original files; returns its entry. */
  addBuild(build: FakeBuild): CalibrationTreeManifestEntry {
    const source = build.kind === "release" ? build.releaseId! : build.stagingRunId!;
    const buildArtifactId = fakeBuildId(
      `${build.country}:${build.kind}:${source}${build.variant ? `:${build.variant}` : ""}`,
    );
    const entry: CalibrationTreeManifestEntry = {
      buildArtifactId,
      kind: build.kind,
      sourceId: source,
      label: build.label ?? source,
      releaseId: build.kind === "release" ? source : null,
      ...(build.releaseDirectory ? { releaseDirectory: build.releaseDirectory } : {}),
      stagingRunId: build.kind === "staging" ? source : null,
      hfRepo: build.hfRepo ?? `policyengine/fake-${build.country}`,
      hfCommitSha: fakeCommit(source),
      treeSchemaVersion: CALIBRATION_TREE_SCHEMA_VERSION,
      indexSha256: sha256(`index:${buildArtifactId}`),
      indexBytes: 1,
      createdAt: build.updatedAt === undefined ? "2026-10-20T00:00:00.000Z" : build.updatedAt,
      updatedAt: build.updatedAt === undefined ? "2026-10-20T00:00:00.000Z" : build.updatedAt,
    };
    this.manifest = withCalibrationTreeManifestEntry(
      this.manifest,
      build.country,
      entry,
      build.latest === true,
      { replaceStagingRun: build.replaceStagingRun === true },
    );
    for (const [file, document] of Object.entries(build.files)) {
      this.objects.set(
        calibrationTreeSourceFilePath(
          build.country,
          buildArtifactId,
          file as CalibrationTreeSourceFile,
        ),
        gzipSync(bytesOf(document!)),
      );
    }
    return entry;
  }

  /** Stores a country's `releases.json` copy; null records a repository without one. */
  addReleasesRecord(country: MicrocosmCountry, record: Document | null): void {
    this.objects.set(
      storedReleasesRecordPath(country),
      new TextEncoder().encode(
        storedReleasesRecordDocument({
          country,
          hfRepo: `policyengine/fake-${country}`,
          hfCommitSha: fakeCommit(`releases-${country}`),
          copiedAt: "2026-10-20T00:00:00.000Z",
          recordBytes: record == null ? null : bytesOf(record),
        }),
      ),
    );
  }

  /** The country's index of copied runs, created empty: a repository with no runs. */
  stagingIndex(country: MicrocosmCountry): StagingRunFilesIndex {
    const index = this.stagingIndexes.get(country) ?? {
      schemaVersion: STAGING_RUN_FILES_SCHEMA_VERSION,
      country,
      hfRepo: `policyengine/fake-${country}-staging`,
      updatedAt: "2026-10-20T00:00:00.000Z",
      runs: {},
    };
    this.stagingIndexes.set(country, index);
    return index;
  }

  /** Copies a staging run's files into its country's index. */
  addStagingRun(run: FakeStagingRun): void {
    const index = this.stagingIndex(run.country);
    const files: Partial<Record<StagingRunFileName, StagingRunFileRecord>> = {};
    for (const [name, document] of Object.entries(run.files)) {
      const bytes = bytesOf(document!);
      const digest = sha256(bytes);
      const compressed = gzipSync(bytes);
      const path = stagingRunFilePath(run.country, run.runId, digest);
      this.objects.set(path, compressed);
      files[name as StagingRunFileName] = {
        path,
        sha256: digest,
        rawBytes: bytes.byteLength,
        gzipBytes: compressed.byteLength,
        hfBlobId: digest.slice(0, 40),
      };
    }
    const progress = run.files["progress.json"];
    const manifest = run.files["run_manifest.json"];
    const parse = (document: Document | undefined) =>
      document == null
        ? null
        : (typeof document === "string" ? JSON.parse(document) : document) as Record<string, unknown>;
    const summary = progress != null
      ? summaryFromProgress(run.runId, {
          ...parse(progress)!,
          stage: parse(progress)!.stage ?? parse(progress)!.current_stage,
          candidate_release_id:
            parse(progress)!.candidate_release_id ?? parse(progress)!.candidate_id,
        })
      : summaryFromManifest(run.runId, parse(manifest) ?? {});
    index.runs[run.runId] = {
      runId: run.runId,
      hfCommitSha: fakeCommit(run.runId),
      copiedAt: "2026-10-20T00:00:00.000Z",
      folderFingerprint: sha256(`folder:${run.runId}`),
      summary,
      problem: run.problem ?? null,
      files,
      treeCheck: null,
      ...(run.removed ? { removedAt: "2026-10-21T00:00:00.000Z" } : {}),
    };
    this.stagingIndexes.set(run.country, index);
  }

  private object(path: string): Uint8Array | null {
    if (path === MANIFEST_PATH) return bytesOf(JSON.stringify(this.manifest));
    for (const [country, index] of this.stagingIndexes) {
      if (path === stagingRunFilesIndexPath(country)) return bytesOf(JSON.stringify(index));
    }
    return this.objects.get(path) ?? null;
  }

  /** As `@vercel/blob`'s `get` answers: null for a missing object. */
  readonly get = (async (pathname: string) => {
    this.requests.push(pathname);
    if (this.failure) throw this.failure;
    const body = this.object(pathname);
    if (body == null) return null;
    return {
      statusCode: 200,
      stream: new Response(new Uint8Array(body)).body!,
      headers: new Headers(),
      blob: {
        url: `https://store.example/${pathname}`,
        downloadUrl: `https://store.example/${pathname}?download=1`,
        pathname,
        contentType: "application/octet-stream",
        contentDisposition: "",
        cacheControl: "",
        size: body.byteLength,
        uploadedAt: new Date("2026-10-20T00:00:00Z"),
        etag: `"${sha256(body)}"`,
      },
    };
  }) as unknown as typeof collectorStoreBlob.get;

  readonly fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === HUGGING_FACE_HOST || url.hostname.endsWith(`.${HUGGING_FACE_HOST}`)) {
      this.huggingFaceRequests.push(url.toString());
      return new Response("Hugging Face is not available in this test.", { status: 500 });
    }
    if (this.otherRequests) return this.otherRequests(input);
    throw new Error(`Unexpected request in a collector store test: ${url.toString()}`);
  }) as typeof fetch;

  /**
   * Serves this store to the dashboard's readers; returns the function that
   * undoes it. Requests to neither the store nor Hugging Face go to
   * `otherRequests`.
   */
  install(otherRequests: typeof fetch | null = null): () => void {
    this.otherRequests = otherRequests;
    const originalFetch = globalThis.fetch;
    const originalSettings = Object.fromEntries(
      CREDENTIAL_SETTINGS.map((name) => [name, process.env[name]]),
    );
    for (const name of CREDENTIAL_SETTINGS) delete process.env[name];
    const blobGet = spyOn(collectorStoreBlob, "get").mockImplementation(this.get);
    globalThis.fetch = this.fetch;
    return () => {
      blobGet.mockRestore();
      globalThis.fetch = originalFetch;
      for (const name of CREDENTIAL_SETTINGS) {
        const original = originalSettings[name];
        if (original == null) delete process.env[name];
        else process.env[name] = original;
      }
    };
  }
}
