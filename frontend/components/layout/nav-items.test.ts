import { expect, test } from "bun:test";

import { hasCapability, selectableCountries } from "@/lib/microcosm/countries";

import {
  isActive,
  navGroupsForCountry,
  navItemHref,
  navLinkAttributes,
  NAV_GROUPS,
} from "./nav-items";

function datasetAccuracyItems() {
  const group = NAV_GROUPS.find((item) => item.label === "Dataset accuracy");
  if (!group) throw new Error("Dataset accuracy nav group not found");
  return group.items;
}

test("keeps calibration targets out of the sidebar", () => {
  const items = datasetAccuracyItems();

  expect(items.some((item) => item.label === "Calibration targets")).toBe(false);
  expect(items.some((item) => item.href === "/microcosm/targets")).toBe(false);
});

test("places external checks at the bottom of dataset accuracy", () => {
  const items = datasetAccuracyItems();

  expect(items.at(-1)?.href).toBe("https://www.policyengine.org/scorecard");
  expect(items.at(-1)?.label).toBe("External checks");
});

test("models the external checks icon separately from its label", () => {
  const externalChecks = datasetAccuracyItems().find(
    (item) => item.href === "https://www.policyengine.org/scorecard",
  );

  expect(externalChecks?.label).toBe("External checks");
  expect(externalChecks?.external).toBe(true);
});

test("targets path does not activate calibration fit", () => {
  const items = datasetAccuracyItems();
  const calibrationFit = items.find((item) => item.label === "Calibration fit");

  if (!calibrationFit) {
    throw new Error("Calibration fit nav item not found");
  }

  expect(calibrationFit.also ?? []).not.toContain("/microcosm/targets");
  expect(isActive("/microcosm", calibrationFit)).toBe(true);
  expect(isActive("/microcosm/targets", calibrationFit)).toBe(false);
});
test("opens external navigation in a new tab without changing internal navigation", () => {
  const items = datasetAccuracyItems();
  const externalChecks = items.find(
    (item) => item.href === "https://www.policyengine.org/scorecard",
  );
  const calibrationFit = items.find((item) => item.href === "/microcosm");

  if (!externalChecks || !calibrationFit) {
    throw new Error("Expected navigation items not found");
  }

  expect(navLinkAttributes(externalChecks)).toEqual({
    target: "_blank",
    rel: "noopener noreferrer",
  });
  expect(navLinkAttributes(calibrationFit)).toEqual({});
});

test("preserves the Cross-dataset navigation label and route", () => {
  const item = datasetAccuracyItems().find((candidate) => candidate.label === "Cross-dataset");
  expect(item).toEqual({
    href: "/microcosm/datasets",
    label: "Cross-dataset",
    capability: "cross_dataset",
  });
  expect(isActive("/microcosm/datasets", item!)).toBe(true);
});

test("every navigation item is gated by a capability, never by a country code", () => {
  const items = NAV_GROUPS.flatMap((group) => group.items);
  expect(items.every((item) => item.capability != null)).toBe(true);
  expect(items.find((item) => item.href === "/microcosm/staging")?.capability).toBe("staging");
  expect(items.find((item) => item.href === "/microcosm/model-coverage")?.capability).toBe(
    "model_coverage",
  );
  expect(items.find((item) => item.href === "/microcosm/pipeline")?.capability).toBe("pipeline");
  expect(items.find((item) => item.href === "/microcosm/variables")?.capability).toBe(
    "variables",
  );
  expect(items.find((item) => item.label === "External checks")?.capability).toBe(
    "external_checks",
  );
});

test("Belgium navigation keeps country-ready pages and hides pages it lacks capabilities for", () => {
  const items = navGroupsForCountry("be").flatMap((group) => group.items);
  expect(items.map((item) => item.href)).toEqual([
    "/microcosm",
    "/microcosm/datasets",
    "/microcosm/compare",
  ]);
  expect(items.every((item) => hasCapability("be", item.capability!))).toBe(true);
  expect(items.map((item) => navItemHref(item, "be"))).toEqual([
    "/microcosm?country=be",
    "/microcosm/datasets?country=be",
    "/microcosm/compare?country=be",
  ]);
});

test("US navigation lists every page", () => {
  expect(navGroupsForCountry("us").flatMap((group) => group.items)).toEqual(
    NAV_GROUPS.flatMap((group) => group.items),
  );
});

test("artifact-narrowed capabilities hide pages the release does not serve", () => {
  const groups = navGroupsForCountry("us", ["calibration", "targets"]);
  expect(groups.map((group) => group.label)).toEqual(["Dataset accuracy"]);
  expect(groups[0].items.map((item) => item.href)).toEqual(["/microcosm"]);
});

test("shows Cross-dataset navigation for every selectable country", () => {
  for (const country of selectableCountries()) {
    expect(
      navGroupsForCountry(country)
        .flatMap((group) => group.items)
        .some((item) => item.href === "/microcosm/datasets"),
    ).toBe(true);
  }
});
