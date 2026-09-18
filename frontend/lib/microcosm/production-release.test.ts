import { expect, test } from "bun:test";

import {
  HOSTED_US_RELEASE,
  reviewedVariableRelease,
} from "./production-release";
import {
  hfResolveUrl,
  microcosmRevision,
} from "./latest-artifact";

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
