import { afterEach, expect, test } from "bun:test";

import {
  assertReviewedRepository,
  HOSTED_US_RELEASE,
  reviewedVariableRelease,
} from "./production-release";
import { hfResolveUrl, loadPointerReleaseId, loadRelease } from "./latest-artifact";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("production default never follows a newly published latest pointer", async () => {
  globalThis.fetch = Object.assign(() => {
    throw new Error("The pinned selection must not fetch latest.json");
  }, { preconnect: originalFetch.preconnect });

  expect(await loadPointerReleaseId(0, "us")).toEqual({
    release_id: HOSTED_US_RELEASE.release_id,
    updated_at: null,
  });
  expect(hfResolveUrl("latest.json")).toContain(`/resolve/${HOSTED_US_RELEASE.hf_revision}/`);
  expect(reviewedVariableRelease()).toBe(HOSTED_US_RELEASE.release_id);
});

test("numeric lookup rejects mutable selectors and incompatible future releases", () => {
  for (const release of ["latest", "main", "future-canonical-release"]) {
    expect(() => reviewedVariableRelease(release)).toThrow("not supported by this runtime");
  }
  expect(reviewedVariableRelease(HOSTED_US_RELEASE.release_id)).toBe(HOSTED_US_RELEASE.release_id);
  expect(() => assertReviewedRepository(HOSTED_US_RELEASE.repo, "main")).toThrow("immutable");
});

test("historical diagnostics remain readable at the immutable repository revision", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return Response.json(url.includes("/tree/") ? [] : { targets: [] });
  }) as typeof fetch;

  const result = await loadRelease("historical-review-fixture", 0, "us");
  expect(result.release_id).toBe("historical-review-fixture");
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.every((url) => url.includes(HOSTED_US_RELEASE.hf_revision))).toBe(true);
  expect(urls.every((url) => !url.endsWith("latest.json"))).toBe(true);
});
