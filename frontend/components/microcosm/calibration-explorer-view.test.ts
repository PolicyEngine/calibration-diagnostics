import { describe, expect, test } from "bun:test";

import type { ExplorerState } from "../../lib/microcosm/calibration-explorer";
import {
  explorerBreadcrumbs,
  explorerEmptyMessage,
  explorerUpLabel,
} from "./calibration-explorer-view";

const EMPTY_FILTERS = {
  geographyLevels: [],
  geographies: [],
  fitBands: [],
  calibrationStatuses: [],
};

function state(path: ExplorerState["path"], filtered = false): ExplorerState {
  return {
    path,
    filters: filtered
      ? { ...EMPTY_FILTERS, geographies: ["CA"] }
      : EMPTY_FILTERS,
  };
}

describe("calibration explorer presentation model", () => {
  test("hides Up at the overview and labels each parent destination", () => {
    expect(explorerUpLabel(state({ dimensions: [] }))).toBeNull();
    expect(
      explorerUpLabel(
        state({ source: "census", program: "population", dimensions: [] }),
      ),
    ).toBe("Up to all programs");
    expect(
      explorerUpLabel(
        state({
          source: "census",
          program: "population",
          measure: "count",
          dimensions: [],
        }),
      ),
    ).toBe("Up to Measure");
    expect(
      explorerUpLabel(
        state({
          source: "census",
          program: "population",
          measure: "count",
          dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
        }),
      ),
    ).toBe("Up to Age");
  });

  test("builds orientation breadcrumbs from the semantic path", () => {
    expect(
      explorerBreadcrumbs(
        state({
          source: "census",
          program: "population",
          measure: "count",
          dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
        }),
      ),
    ).toEqual(["All programs", "Census", "Population", "Count", "Adult"]);
  });

  test("distinguishes an empty filtered result from an invalid hierarchy scope", () => {
    expect(explorerEmptyMessage(state({ dimensions: [] }, true))).toContain(
      "filters",
    );
    expect(
      explorerEmptyMessage(
        state({ source: "census", program: "missing", dimensions: [] }),
      ),
    ).toContain("selection");
  });
});
