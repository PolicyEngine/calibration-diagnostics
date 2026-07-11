import { expect, test } from "bun:test";

import {
  defaultReleaseBadge,
  gatesBadge,
  isBadgeMetric,
  releaseBuildSlug,
  within10Badge,
} from "./badges";

test("releaseBuildSlug pulls the build name out of a release id", () => {
  expect(
    releaseBuildSlug("populace-us-2024-buildi-sparse-rmloss100-6e8e929-20260709T034135Z"),
  ).toBe("buildi");
  expect(releaseBuildSlug("populace-us-2024-f0af251-703bd81a565c-20260620T201958Z")).toBe(
    "f0af251",
  );
});

test("default-release badge is a valid shield", () => {
  const badge = defaultReleaseBadge("populace-us-2024-buildi-x-20260709T034135Z", "us");
  expect(badge.schemaVersion).toBe(1);
  expect(badge.label).toBe("populace-us default");
  expect(badge.message).toBe("buildi");
  expect(badge.color).toBe("blue");
});

test("gates badge colors green only when all ran gates passed", () => {
  expect(gatesBadge(11, 11, 0).color).toBe("brightgreen");
  expect(gatesBadge(10, 11, 0).color).toBe("yellow");
  expect(gatesBadge(9, 11, 2).color).toBe("red");
  expect(gatesBadge(11, 11, 0).message).toBe("11/11");
});

test("within10 badge formats the share and grades the color", () => {
  expect(within10Badge(0.8888).message).toBe("88.9%");
  expect(within10Badge(0.8888).color).toBe("brightgreen");
  expect(within10Badge(0.75).color).toBe("yellow");
  expect(within10Badge(0.5).color).toBe("orange");
  expect(within10Badge(null).message).toBe("unknown");
});

test("isBadgeMetric guards the route parameter", () => {
  expect(isBadgeMetric("gates")).toBe(true);
  expect(isBadgeMetric("within10")).toBe(true);
  expect(isBadgeMetric("default-release")).toBe(true);
  expect(isBadgeMetric("nonsense")).toBe(false);
});
