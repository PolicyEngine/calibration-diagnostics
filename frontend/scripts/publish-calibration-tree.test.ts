import { expect, test } from "bun:test";

import {
  CalibrationTreeArtifactSizeError,
  enforceConfiguredSizeLimits,
  parsePublisherOptions,
  readUpstreamLatest,
  resolvePublicationSourceSha,
} from "./publish-calibration-tree";

const originalFetch = globalThis.fetch;

test("publisher accepts latest, immutable release, backfill, and staging modes", () => {
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
});

test("publisher rejects ambiguous modes and unsafe release ids", () => {
  expect(() => parsePublisherOptions(["--latest", "--backfill"])).toThrow(
    "exactly one",
  );
  expect(() => parsePublisherOptions(["--release", "../latest"])).toThrow(
    "valid immutable release id",
  );
});

test("publisher enforces configured artifact size limits", () => {
  const previous = process.env.CALIBRATION_TREE_MAX_RAW_BYTES;
  process.env.CALIBRATION_TREE_MAX_RAW_BYTES = "10";
  try {
    expect(() => enforceConfiguredSizeLimits({
      part: "target-details-0001",
      path: `calibration-trees/us/${"a".repeat(64)}/target-details-0001.json`,
      artifact: {} as never,
      serialized: "12345678901",
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
