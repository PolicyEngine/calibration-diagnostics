import { expect, test } from "bun:test";

import {
  countrySwitchUrl,
  isCountry,
  selectedReleaseForCountry,
} from "./country-context";

test("country switching clears bundle-specific Cross-dataset state", () => {
  const switched = new URL(
    countrySwitchUrl(
      "https://example.test/microcosm/datasets?country=us&view=fact&fact_key=us-only&source=us-model",
      "be",
    ),
  );

  expect(switched.pathname).toBe("/microcosm/datasets");
  expect(switched.searchParams.toString()).toBe("country=be");
});

test("country switching preserves route filters but clears the selected release", () => {
  const switched = new URL(
    countrySwitchUrl(
      "https://example.test/microcosm/targets?country=us&release=us-build&variable=income_tax",
      "uk",
    ),
  );

  expect(switched.pathname).toBe("/microcosm/targets");
  expect(switched.searchParams.toString()).toBe("country=uk&variable=income_tax");
  expect(switched.searchParams.has("release")).toBe(false);
});

test("a release selection is used only by the country that supplied it", () => {
  const selection = { country: "us" as const, value: "us-build" };

  expect(selectedReleaseForCountry("us", selection)).toBe("us-build");
  expect(selectedReleaseForCountry("be", selection)).toBe("");
});

test("the client country parser accepts every registered country and nothing else", () => {
  expect(isCountry("us")).toBe(true);
  expect(isCountry("uk")).toBe(true);
  expect(isCountry("be")).toBe(true);
  expect(isCountry("zz")).toBe(true);
  expect(isCountry("US")).toBe(false);
  expect(isCountry("fr")).toBe(false);
  expect(isCountry("")).toBe(false);
  expect(isCountry(null)).toBe(false);
});
