import { expect, test } from "bun:test";

import type { CalibrationProvenance } from "@policyengine/calibration-tree/target-loss-attribution";

import { parseStagingTab } from "@/components/microcosm/staging-page-tabs";
import {
  buildProgressHref,
  inheritedCalibrationParent,
  inheritedCalibrationSource,
  parentBuildFromManifest,
  parentBuildRelease,
  type ParentBuildResponse,
} from "@/lib/microcosm/inherited-calibration";
import { stagingRunForCountry } from "@/lib/microcosm/staging-run-url";

// A US compatibility recertification and the build whose calibration
// diagnostics it copies, as published on Hugging Face. The parent's staging
// run name is the US certified-build tool's own form, which need not be the
// build ID.
const RECERTIFIED_BUILD =
  "microcosm-us-2024-national/populace-us-2024-b5db384-recert-pe-us-2.90.4-r085672fa9";
const PARENT_BUILD = "populace-us-2024-b5db384-8b0c1950b65f-20261024T083103Z";
const PARENT_RUN = "populace-us-build-20261024T083103Z-1a2b3c4d";

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

function parentBuild(overrides: Partial<ParentBuildResponse> = {}): ParentBuildResponse {
  return {
    release_id: RECERTIFIED_BUILD,
    parent_build_id: PARENT_BUILD,
    staging_run_id: PARENT_RUN,
    ...overrides,
  };
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

test("the parent build manifest's own staging block names the parent's staging run", () => {
  expect(
    parentBuildFromManifest({
      build_id: PARENT_BUILD,
      staging: { enabled: true, run_id: PARENT_RUN, uploads_succeeded: 711 },
    }),
  ).toEqual({ parent_build_id: PARENT_BUILD, staging_run_id: PARENT_RUN });
  // A build-folder manifest names its build in `build`.
  expect(
    parentBuildFromManifest({ build: PARENT_BUILD, staging: { enabled: true, run_id: PARENT_RUN } }),
  ).toEqual({ parent_build_id: PARENT_BUILD, staging_run_id: PARENT_RUN });
});

test("a parent built without staging, or with no run recorded, has no staging run", () => {
  expect(
    parentBuildFromManifest({ build_id: PARENT_BUILD, staging: { enabled: false, run_id: null } }),
  ).toEqual({ parent_build_id: PARENT_BUILD, staging_run_id: null });
  expect(
    parentBuildFromManifest({ build_id: PARENT_BUILD, staging: { enabled: true, run_id: "  " } }),
  ).toEqual({ parent_build_id: PARENT_BUILD, staging_run_id: null });
  expect(
    parentBuildFromManifest({ build_id: PARENT_BUILD, staging: { enabled: false, run_id: PARENT_RUN } }),
  ).toEqual({ parent_build_id: PARENT_BUILD, staging_run_id: null });
  expect(parentBuildFromManifest({ build_id: PARENT_BUILD })).toEqual({
    parent_build_id: PARENT_BUILD,
    staging_run_id: null,
  });
  expect(parentBuildFromManifest(null)).toEqual({ parent_build_id: null, staging_run_id: null });
});

test("the parent build is asked about only for an inherited calibration where the country has staging runs", () => {
  expect(parentBuildRelease(RECERTIFIED_PROVENANCE, "us", RECERTIFIED_BUILD)).toBe(
    RECERTIFIED_BUILD,
  );
  expect(parentBuildRelease(RECERTIFIED_PROVENANCE, "be", RECERTIFIED_BUILD)).toBeUndefined();
  expect(parentBuildRelease(provenance(), "us", RECERTIFIED_BUILD)).toBeUndefined();
  expect(parentBuildRelease(RECERTIFIED_PROVENANCE, "us", undefined)).toBeUndefined();
});

test("the parent's Build progress link opens its run on the Staging page's Build progress tab", () => {
  const url = new URL(buildProgressHref("us", PARENT_RUN), "https://example.test");

  expect(url.pathname).toBe("/microcosm/staging");
  expect(parseStagingTab(url.searchParams.get("view"))).toBe("progress");
  expect(stagingRunForCountry(url.searchParams, "us")).toBe(PARENT_RUN);
});

test("a recertified build whose parent has a staging run links to that run, whatever it is named", () => {
  expect(inheritedCalibrationSource(RECERTIFIED_PROVENANCE, "us", parentBuild())).toEqual({
    parentBuildId: PARENT_BUILD,
    buildProgressHref: buildProgressHref("us", PARENT_RUN),
  });
});

test("without a staging run for the declared parent, the parent is named with no build progress link", () => {
  const unlinked = { parentBuildId: PARENT_BUILD, buildProgressHref: null };
  // Not answered yet, or the answer failed.
  expect(inheritedCalibrationSource(RECERTIFIED_PROVENANCE, "us", undefined)).toEqual(unlinked);
  // The parent was built without staging, or the build has no parent manifest.
  expect(
    inheritedCalibrationSource(RECERTIFIED_PROVENANCE, "us", parentBuild({ staging_run_id: null })),
  ).toEqual(unlinked);
  expect(
    inheritedCalibrationSource(
      RECERTIFIED_PROVENANCE,
      "us",
      parentBuild({ parent_build_id: null, staging_run_id: null }),
    ),
  ).toEqual(unlinked);
  // A parent manifest for another build than the one the calibration names.
  expect(
    inheritedCalibrationSource(
      RECERTIFIED_PROVENANCE,
      "us",
      parentBuild({ parent_build_id: "populace-us-2024-spm-20260915" }),
    ),
  ).toEqual(unlinked);
  // A country without staging runs links to none.
  expect(inheritedCalibrationSource(RECERTIFIED_PROVENANCE, "be", parentBuild())).toEqual(unlinked);
});

test("a build calibrated on its own shows no parent", () => {
  expect(inheritedCalibrationSource(provenance(), "us", parentBuild())).toBeNull();
  expect(inheritedCalibrationSource(undefined, "us", undefined)).toBeNull();
});
