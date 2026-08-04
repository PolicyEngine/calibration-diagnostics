import { expect, test } from "bun:test";

import type { ExplorerState } from "./calibration-explorer";
import {
  explorerVariableKey,
  targetDiagnosticsParamsFromExplorer,
} from "./calibration-targets-handoff";

const state: ExplorerState = {
  path: {
    source: "census",
    program: "population",
    measure: "count",
    dimensions: [
      { key: "bd_age", label: "Age", value: "Adult" },
      { key: "bd_sex", label: "Sex", value: "__missing__" },
    ],
    target: "population/count/adult",
  },
  filters: {
    geographyLevels: ["state"],
    geographies: ["CA", "NY"],
    fitBands: ["0_5", "10_20"],
    calibrationStatuses: ["included", "skipped"],
  },
};

test("maps an explorer scope onto the existing targets diagnostics contract", () => {
  expect(explorerVariableKey(state.path)).toBe("census / population · count");
  expect(targetDiagnosticsParamsFromExplorer(state)).toEqual({
    variable: "census / population · count",
    facet: ["bd_age:Adult", "bd_sex:__missing__"],
    geography_level: ["state"],
    geography: ["CA", "NY"],
    fit_band: ["0_5", "10_20"],
    status: ["included", "skipped"],
  });
});

test("does not invent a variable key before the measure level", () => {
  const programState: ExplorerState = {
    path: { source: "census", program: "population", dimensions: [] },
    filters: {
      geographyLevels: [],
      geographies: [],
      fitBands: [],
      calibrationStatuses: [],
    },
  };
  expect(explorerVariableKey(programState.path)).toBeUndefined();
  expect(targetDiagnosticsParamsFromExplorer(programState)).toEqual({
    source: "census",
    program: "population",
  });
});
