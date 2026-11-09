import { expect, test } from "bun:test";

import { stagingRunForCountry, stagingRunFromSearch, withStagingRun } from "@/lib/microcosm/staging-run-url";

const PAGE = "https://example.test/calibration/dashboard/microcosm/staging";

test("choosing a run puts its ID in the URL and keeps the tab and country", () => {
  const url = new URL(
    withStagingRun(`${PAGE}?view=progress&country=uk`, "uk-frs-spine-20261105T141147Z", "uk"),
  );

  expect(url.pathname).toBe("/calibration/dashboard/microcosm/staging");
  expect(url.searchParams.get("view")).toBe("progress");
  expect(url.searchParams.get("country")).toBe("uk");
  expect(url.searchParams.get("run")).toBe("uk-frs-spine-20261105T141147Z");
});

test("choosing another run replaces the run in the URL, and no run removes it", () => {
  const replaced = new URL(withStagingRun(`${PAGE}?run=old-run&view=progress`, "new-run", "us"));
  expect(replaced.searchParams.getAll("run")).toEqual(["new-run"]);

  const cleared = new URL(withStagingRun(`${PAGE}?run=old-run&view=progress`, "", "us"));
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

test("choosing a run also writes the page's country, so the link opens the run there", () => {
  // A page opened without `country` took it from the viewer's stored choice;
  // a link without it would open under the recipient's.
  const url = new URL(withStagingRun(`${PAGE}?view=progress`, "uk-frs-spine-20261105T141147Z", "uk"));

  expect(url.searchParams.get("country")).toBe("uk");
  expect(url.searchParams.get("run")).toBe("uk-frs-spine-20261105T141147Z");
});

test("a run is read from the URL only for the country the URL names", () => {
  // Switching country remounts the page while the URL still holds the
  // previous country's run.
  expect(stagingRunForCountry(new URLSearchParams("country=us&run=us-run"), "uk")).toBe("");
  expect(stagingRunForCountry(new URLSearchParams("country=uk&run=uk-run"), "uk")).toBe("uk-run");
  // A link that names no country is read for the country the page shows.
  expect(stagingRunForCountry(new URLSearchParams("run=some-run"), "uk")).toBe("some-run");
});
