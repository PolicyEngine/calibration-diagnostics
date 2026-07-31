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
  expect(items[calibrationTargetsIndex]?.href).toBe("/populace/targets");
});

test("targets path activates calibration targets instead of calibration fit", () => {
  const items = datasetAccuracyItems();
  const calibrationFit = items.find((item) => item.label === "Calibration fit");
  const calibrationTargets = items.find((item) => item.label === "Calibration targets");

  if (!calibrationFit || !calibrationTargets) {
    throw new Error("Calibration nav items not found");
  }

  expect(calibrationFit.also ?? []).not.toContain("/populace/targets");
  expect(isActive("/populace", calibrationFit)).toBe(true);
  expect(isActive("/populace/targets", calibrationFit)).toBe(false);
  expect(isActive("/populace/targets", calibrationTargets)).toBe(true);
});

test("does not expose the retired cross-dataset evaluation", () => {
  const items = datasetAccuracyItems();

  expect(items.some((item) => item.label === "Cross-dataset")).toBe(false);
  expect(items.some((item) => item.href === "/populace/datasets")).toBe(false);
});
