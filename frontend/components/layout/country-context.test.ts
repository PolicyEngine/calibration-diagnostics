import { expect, test } from "bun:test";
import fc from "fast-check";

import { isSelectableCountry } from "@policyengine/calibration-tree/countries";
import {
  countrySwitchUrl,
  isCountry,
  selectedReleaseForCountry,
  urlCountryState,
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

test("a URL country selects itself, and an unconfigured one is never replaced by another", () => {
  expect(urlCountryState("uk", "be")).toEqual({ kind: "country", country: "uk", persist: true });
  // The production report (2026-10-20): ?country=nz showed the US release.
  expect(urlCountryState("nz", "uk")).toEqual({ kind: "not_configured", requested: "nz" });
  expect(urlCountryState("NZ", null)).toEqual({ kind: "not_configured", requested: "NZ" });
  expect(urlCountryState("zz", null)).toEqual({ kind: "not_configured", requested: "zz" });
});

test("without a URL country the remembered selectable choice, or the default, is used", () => {
  expect(urlCountryState(null, "be")).toEqual({ kind: "country", country: "be", persist: false });
  expect(urlCountryState("", "uk")).toEqual({ kind: "country", country: "uk", persist: false });
  expect(urlCountryState(null, "zz")).toEqual({ kind: "country", country: "us", persist: false });
  expect(urlCountryState(null, "nz")).toEqual({ kind: "country", country: "us", persist: false });
  expect(urlCountryState(null, null)).toEqual({ kind: "country", country: "us", persist: false });
});

test("property: a present URL country is shown as itself or as not configured", () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.string({ minLength: 1 }), fc.constantFrom("us", "uk", "be", "zz", "am", "nz")),
      fc.option(fc.oneof(fc.string(), fc.constantFrom("us", "uk", "be", "zz"))),
      (urlValue, stored) => {
        const state = urlCountryState(urlValue, stored);
        if (state.kind === "country") {
          expect<string>(state.country).toBe(urlValue);
          expect(isSelectableCountry(urlValue)).toBe(true);
        } else {
          expect(state.requested).toBe(urlValue);
          expect(isSelectableCountry(urlValue)).toBe(false);
        }
      },
    ),
    { numRuns: 1_000 },
  );
});
