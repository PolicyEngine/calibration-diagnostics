import { describe, expect, test } from "bun:test";

import {
  targetRepresentationForSchema,
  UnsupportedCalibrationDiagnosticsSchemaError,
} from "./target-representation";

describe("calibration target representation", () => {
  test("dispatches historical and current readers only by top-level version", () => {
    for (const schemaVersion of [2, 3, 4, 5, 6]) {
      expect(targetRepresentationForSchema(schemaVersion)).toBe("legacy");
    }
    expect(targetRepresentationForSchema(7)).toBe("structured");
    expect(targetRepresentationForSchema(8)).toBe("hierarchy");
  });

  test("rejects versions without a supported compatibility contract", () => {
    for (const schemaVersion of [undefined, null, "8", 1, 9, 7.5]) {
      expect(() => targetRepresentationForSchema(schemaVersion)).toThrow(
        UnsupportedCalibrationDiagnosticsSchemaError,
      );
    }
  });
});
