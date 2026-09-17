import { afterEach, expect, test } from "bun:test";

import {
  HOSTED_US_RELEASE,
  reviewedVariableRelease,
} from "./production-release";
import {
  hfResolveUrl,
  loadRelease,
  microcosmRevision,
} from "./latest-artifact";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("dashboard discovery follows the repository branch while variable calculation stays pinned", () => {
  expect(microcosmRevision("us")).toBe("main");
  expect(hfResolveUrl("latest.json")).toContain("/resolve/main/");
  expect(reviewedVariableRelease()).toBe(HOSTED_US_RELEASE.release_id);
});

test("numeric lookup rejects mutable selectors and incompatible future releases", () => {
  for (const release of ["latest", "main", "future-canonical-release"]) {
    expect(() => reviewedVariableRelease(release)).toThrow("not supported by this runtime");
  }
  expect(reviewedVariableRelease(HOSTED_US_RELEASE.release_id)).toBe(HOSTED_US_RELEASE.release_id);
});

test("historical diagnostics resolve their tag and read only its immutable commit", async () => {
  const urls: string[] = [];
  const commit = "1234567890abcdef1234567890abcdef12345678";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/revision/historical-review-fixture")) {
      return Response.json({ sha: commit });
    }
    if (url.includes("/tree/")) return Response.json([]);
    return Response.json(
      url.endsWith("/calibration_diagnostics.json")
        ? { schema_version: 5, targets: [] }
        : {},
    );
  }) as typeof fetch;

  const result = await loadRelease("historical-review-fixture", 0, "us");
  expect(result.release_id).toBe("historical-review-fixture");
  expect(result.hf_commit_sha).toBe(commit);
  expect(urls.length).toBeGreaterThan(0);
  expect(
    urls
      .filter((url) => url.includes("/resolve/"))
      .every((url) => url.includes(`/resolve/${commit}/`)),
  ).toBe(true);
  expect(urls.every((url) => !url.endsWith("latest.json"))).toBe(true);
});
