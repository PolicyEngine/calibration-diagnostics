import { expect, test } from "bun:test";

import { isActive, navLinkAttributes, NAV_GROUPS } from "./nav-items";

function datasetAccuracyItems() {
  const group = NAV_GROUPS.find((item) => item.label === "Dataset accuracy");
  if (!group) throw new Error("Dataset accuracy nav group not found");
  return group.items;
}

test("shows calibration targets directly under calibration fit", () => {
  const items = datasetAccuracyItems();
  const labels = items.map((item) => item.label);
  const calibrationFitIndex = labels.indexOf("Calibration fit");
  const calibrationTargetsIndex = labels.indexOf("Calibration targets");

  expect(calibrationFitIndex).toBeGreaterThanOrEqual(0);
  expect(calibrationTargetsIndex).toBe(calibrationFitIndex + 1);
  expect(items[calibrationTargetsIndex]?.href).toBe("/microcosm/targets");
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

test("targets path activates calibration targets instead of calibration fit", () => {
  const items = datasetAccuracyItems();
  const calibrationFit = items.find((item) => item.label === "Calibration fit");
  const calibrationTargets = items.find((item) => item.label === "Calibration targets");

  if (!calibrationFit || !calibrationTargets) {
    throw new Error("Calibration nav items not found");
  }

  expect(calibrationFit.also ?? []).not.toContain("/microcosm/targets");
  expect(isActive("/microcosm", calibrationFit)).toBe(true);
  expect(isActive("/microcosm/targets", calibrationFit)).toBe(false);
  expect(isActive("/microcosm/targets", calibrationTargets)).toBe(true);
});

test("does not expose the retired cross-dataset evaluation", () => {
  const items = datasetAccuracyItems();

  expect(items.some((item) => item.label === "Cross-dataset")).toBe(false);
  expect(items.some((item) => item.href === "/microcosm/datasets")).toBe(false);
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
