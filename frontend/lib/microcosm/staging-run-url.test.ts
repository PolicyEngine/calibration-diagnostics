import { expect, test } from "bun:test";

import { stagingRunFromSearch, withStagingRun } from "@/lib/microcosm/staging-run-url";

const PAGE = "https://example.test/calibration/dashboard/microcosm/staging";

test("choosing a run puts its ID in the URL and keeps the tab and country", () => {
  const url = new URL(
    withStagingRun(`${PAGE}?view=progress&country=uk`, "uk-frs-spine-20261105T141147Z"),
  );

  expect(url.pathname).toBe("/calibration/dashboard/microcosm/staging");
  expect(url.searchParams.get("view")).toBe("progress");
  expect(url.searchParams.get("country")).toBe("uk");
  expect(url.searchParams.get("run")).toBe("uk-frs-spine-20261105T141147Z");
});

test("choosing another run replaces the run in the URL, and no run removes it", () => {
  const replaced = new URL(withStagingRun(`${PAGE}?run=old-run&view=progress`, "new-run"));
  expect(replaced.searchParams.getAll("run")).toEqual(["new-run"]);

  const cleared = new URL(withStagingRun(`${PAGE}?run=old-run&view=progress`, ""));
  expect(cleared.searchParams.has("run")).toBe(false);
  expect(cleared.searchParams.get("view")).toBe("progress");
});

test("the run a URL names is read back, trimmed", () => {
  expect(stagingRunFromSearch(new URLSearchParams("view=progress&run=uk-frs-spine-20261105T141147Z"))).toBe(
    "uk-frs-spine-20261105T141147Z",
  );
  expect(stagingRunFromSearch(new URLSearchParams("run=%20padded-run%20"))).toBe("padded-run");
  expect(stagingRunFromSearch(new URLSearchParams("view=progress"))).toBe("");
});
