import { afterEach, expect, test } from "bun:test";

import {
  calibrationReleaseFromManifest,
  resolveHfRevisionSha,
} from "./calibration-release-locator";
import { withCalibrationTreeManifestEntry, emptyCalibrationTreeManifest } from "./calibration-tree-manifest";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("latest release identity is read only from the dashboard manifest", () => {
  const manifest = withCalibrationTreeManifestEntry(
    emptyCalibrationTreeManifest(),
    "us",
    {
      releaseId: "microcosm-us-new-release",
      hfCommitSha: "1234567890abcdef1234567890abcdef12345678",
      treeSchemaVersion: 2,
      indexSha256: "c".repeat(64),
      indexBytes: 20,
      updatedAt: "2026-09-15T12:00:00.000Z",
    },
  );
  expect(calibrationReleaseFromManifest(manifest, "us")).toEqual({
    releaseId: "microcosm-us-new-release",
    hfCommitSha: "1234567890abcdef1234567890abcdef12345678",
    updatedAt: "2026-09-15T12:00:00.000Z",
  });
});

test("historical release tags resolve to exact Hugging Face commits", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    expect(String(input)).toContain("/revision/microcosm-us-history");
    return Response.json({ sha: "ABCDEF1234567890ABCDEF1234567890ABCDEF12" });
  }) as typeof fetch;
  expect(await resolveHfRevisionSha("us", "microcosm-us-history", 0)).toBe(
    "abcdef1234567890abcdef1234567890abcdef12",
  );
});
