import { expect, test } from "bun:test";

import { isActive, NAV_GROUPS } from "./nav-items";

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

test("preserves the Cross-dataset navigation label and route", () => {
  const item = datasetAccuracyItems().find((candidate) => candidate.label === "Cross-dataset");
  expect(item).toEqual({
    href: "/microcosm/datasets",
    label: "Cross-dataset",
    usOnly: true,
  });
  expect(isActive("/microcosm/datasets", item!)).toBe(true);
});
