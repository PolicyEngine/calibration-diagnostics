import { describe, expect, test } from "bun:test";

import {
  targetRepresentationForDiagnosticsArtifact,
  targetRepresentationForSchema,
  UnsupportedCalibrationDiagnosticsSchemaError,
} from "./target-representation";

describe("calibration target representation", () => {
  test("dispatches historical and current readers only by top-level version", () => {
    for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
      expect(targetRepresentationForSchema(schemaVersion)).toBe("legacy");
    }
    expect(targetRepresentationForSchema(7)).toBe("structured");
    expect(targetRepresentationForSchema(8)).toBe("hierarchy");
  });

  test("rejects versions without a supported compatibility contract", () => {
    for (const schemaVersion of [undefined, null, "8", 0, 9, 7.5]) {
      expect(() => targetRepresentationForSchema(schemaVersion)).toThrow(
        UnsupportedCalibrationDiagnosticsSchemaError,
      );
    }
  });

  test("reads only the exact audited unversioned local-area artifacts", () => {
    const releaseId =
      "populace-us-2024-buildp-acs-local-592ae5d6-20260819T020303Z";
    const sha256 =
      "b6f05b652049f88c044f1907eeed13c378aea47aec9c6dd6518faa90d1a0dcd0";

    expect(
      targetRepresentationForDiagnosticsArtifact(undefined, {
        releaseId,
        sha256,
      }),
    ).toBe("legacy");
    expect(() =>
      targetRepresentationForDiagnosticsArtifact(undefined, {
        releaseId,
        sha256: "0".repeat(64),
      }),
    ).toThrow(UnsupportedCalibrationDiagnosticsSchemaError);
    expect(() =>
      targetRepresentationForDiagnosticsArtifact(undefined, {
        releaseId: "unrecognized-release",
        sha256,
      }),
    ).toThrow(UnsupportedCalibrationDiagnosticsSchemaError);
  });
});
