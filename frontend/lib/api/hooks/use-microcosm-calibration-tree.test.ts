import { expect, test } from "bun:test";

import { createExplorerState } from "@/lib/microcosm/calibration-explorer";
import { CALIBRATION_PREFETCH_POLICY } from "@/lib/microcosm/calibration-prefetch";

import { microcosmCalibrationTreeQueryOptions } from "./use-microcosm";

test("keeps calibration tree layers fresh and resident for six hours", () => {
  const options = microcosmCalibrationTreeQueryOptions(
    createExplorerState(),
    undefined,
    "us",
  );

  expect(options.staleTime).toBe(CALIBRATION_PREFETCH_POLICY.cacheTimeMs);
  expect(options.gcTime).toBe(CALIBRATION_PREFETCH_POLICY.cacheTimeMs);
});
