import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { CalibrationProvenance } from "@/lib/microcosm/target-loss-attribution";
import { CalibrationComparisonProvenanceNotices } from "./calibration-provenance-notice";

function provenance(
  mode: CalibrationProvenance["mode"],
  releaseId: string,
): CalibrationProvenance {
  return {
    mode,
    dataset_release_id: releaseId,
    calibration_source_id: mode === "inherited" ? `${releaseId}-parent` : releaseId,
    diagnostics_sha256: null,
    target_surface_sha256: null,
    validation: {
      status: mode === "inherited" ? "verified" : "not_applicable",
      reason: null,
    },
  };
}

test("labels inherited provenance for both comparison sides", () => {
  const markup = renderToStaticMarkup(
    <CalibrationComparisonProvenanceNotices
      current={provenance("inherited", "current-release")}
      candidate={provenance("inherited", "candidate-release")}
    />,
  );

  expect(markup).toContain("Current release: inherited calibration diagnostics");
  expect(markup).toContain("Candidate: inherited calibration diagnostics");
  expect(markup).toContain("current-release-parent");
  expect(markup).toContain("candidate-release-parent");
});

test("shows only the inherited side of a comparison", () => {
  const markup = renderToStaticMarkup(
    <CalibrationComparisonProvenanceNotices
      current={provenance("direct", "current-release")}
      candidate={provenance("inherited", "candidate-release")}
    />,
  );

  expect(markup).not.toContain("Current release: inherited calibration diagnostics");
  expect(markup).toContain("Candidate: inherited calibration diagnostics");
});
