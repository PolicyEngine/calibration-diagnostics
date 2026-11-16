import { expect, test } from "bun:test";

import type { CalibrationProvenance } from "@policyengine/calibration-tree/target-loss-attribution";

import { parseStagingTab } from "@/components/microcosm/staging-page-tabs";
import {
  buildProgressHref,
  inheritedCalibrationParent,
  inheritedCalibrationSource,
  parentStagingRunId,
} from "@/lib/microcosm/inherited-calibration";
import { stagingRunForCountry } from "@/lib/microcosm/staging-run-url";

// A US compatibility recertification and the build whose calibration
// diagnostics it copies, as published on Hugging Face.
const RECERTIFIED_BUILD =
  "microcosm-us-2024-national/populace-us-2024-b5db384-recert-pe-us-2.90.4-r085672fa9";
const PARENT_BUILD = "populace-us-2024-b5db384-8b0c1950b65f-20261024T083103Z";

function provenance(overrides: Partial<CalibrationProvenance> = {}): CalibrationProvenance {
  return {
    mode: "direct",
    dataset_release_id: RECERTIFIED_BUILD,
    calibration_source_id: RECERTIFIED_BUILD,
    diagnostics_sha256: null,
    target_surface_sha256: null,
    validation: { status: "not_applicable", reason: null },
    ...overrides,
  };
}

// What the tree package derives from the recertified build's manifest:
// `calibration.mode` "inherited" with `calibration.parent_build_id`. No
// loss-attribution recipe is pinned for the parent, so validation fails; the
// parent is still the build the diagnostics came from.
const RECERTIFIED_PROVENANCE = provenance({
  mode: "inherited",
  calibration_source_id: PARENT_BUILD,
  validation: {
    status: "failed",
    reason: "no pinned historical attribution recipe matches the declared parent build",
  },
});

function buildRun(runId: string) {
  return { run: { run_id: runId } };
}

test("an inherited calibration names the parent build its diagnostics came from", () => {
  expect(inheritedCalibrationParent(RECERTIFIED_PROVENANCE)).toBe(PARENT_BUILD);
  expect(
    inheritedCalibrationParent(
      provenance({ mode: "inherited", calibration_source_id: `  ${PARENT_BUILD}\n` }),
    ),
  ).toBe(PARENT_BUILD);
});

test("a build calibrated on its own, or a tree without provenance, names no parent", () => {
  expect(inheritedCalibrationParent(provenance())).toBeNull();
  expect(inheritedCalibrationParent(undefined)).toBeNull();
  expect(inheritedCalibrationParent(null)).toBeNull();
  expect(
    inheritedCalibrationParent(provenance({ mode: "inherited", calibration_source_id: null })),
  ).toBeNull();
  expect(
    inheritedCalibrationParent(provenance({ mode: "inherited", calibration_source_id: "  " })),
  ).toBeNull();
});

test("the parent's staging run is looked up by its build ID, only where the country has staging runs", () => {
  expect(parentStagingRunId(RECERTIFIED_PROVENANCE, "us")).toBe(PARENT_BUILD);
  expect(parentStagingRunId(RECERTIFIED_PROVENANCE, "be")).toBeUndefined();
  expect(parentStagingRunId(provenance(), "us")).toBeUndefined();
});

test("the parent's Build progress link opens its run on the Staging page's Build progress tab", () => {
  const url = new URL(buildProgressHref("us", PARENT_BUILD), "https://example.test");

  expect(url.pathname).toBe("/microcosm/staging");
  expect(parseStagingTab(url.searchParams.get("view"))).toBe("progress");
  expect(stagingRunForCountry(url.searchParams, "us")).toBe(PARENT_BUILD);
});

test("a recertified build whose parent has a staging run names the parent and links to its build progress", () => {
  expect(
    inheritedCalibrationSource(RECERTIFIED_PROVENANCE, "us", buildRun(PARENT_BUILD)),
  ).toEqual({
    parentBuildId: PARENT_BUILD,
    buildProgressHref: buildProgressHref("us", PARENT_BUILD),
  });
});

test("without the parent's own staging run, the parent is named with no build progress link", () => {
  // Not found, or still loading.
  expect(inheritedCalibrationSource(RECERTIFIED_PROVENANCE, "us", undefined)).toEqual({
    parentBuildId: PARENT_BUILD,
    buildProgressHref: null,
  });
  // The previous run's answer, kept while the parent's loads.
  expect(
    inheritedCalibrationSource(
      RECERTIFIED_PROVENANCE,
      "us",
      buildRun("populace-us-2024-spm-20260915"),
    ),
  ).toEqual({ parentBuildId: PARENT_BUILD, buildProgressHref: null });
  // A country without staging runs links to none.
  expect(
    inheritedCalibrationSource(RECERTIFIED_PROVENANCE, "be", buildRun(PARENT_BUILD)),
  ).toEqual({ parentBuildId: PARENT_BUILD, buildProgressHref: null });
});

test("a build calibrated on its own shows no parent", () => {
  expect(inheritedCalibrationSource(provenance(), "us", buildRun(PARENT_BUILD))).toBeNull();
  expect(inheritedCalibrationSource(undefined, "us", undefined)).toBeNull();
});
