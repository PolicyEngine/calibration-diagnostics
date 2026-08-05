import { describe, expect, test } from "bun:test";

import type { ExplorerState } from "../../lib/microcosm/calibration-explorer";
import {
  explorerBreadcrumbs,
  explorerEmptyMessage,
  explorerSizePhrase,
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
          geography: "CA",
          dimensions: [],
        }),
      ),
    ).toBe("Up to all geographies");
    expect(
      explorerUpLabel(
        state({
          source: "census",
          program: "population",
          geography: "CA",
          dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
        }),
      ),
    ).toBe("Up to Age");
  });

  test("builds orientation breadcrumbs from the semantic path", () => {
    expect(explorerBreadcrumbs(state({ dimensions: [] }))).toEqual([
      { label: "All targets", path: { dimensions: [] } },
    ]);
    expect(
      explorerBreadcrumbs(
        state({
          source: "census",
          program: "population",
          geography: "CA",
          dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
        }),
      ),
    ).toEqual([
      { label: "All targets", path: { dimensions: [] } },
      { label: "Census", path: { dimensions: [] } },
      {
        label: "Population",
        path: { source: "census", program: "population", dimensions: [] },
      },
      {
        label: "CA",
        path: {
          source: "census",
          program: "population",
          geography: "CA",
          dimensions: [],
        },
      },
      {
        label: "Adult",
        path: {
          source: "census",
          program: "population",
          geography: "CA",
          dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
        },
      },
    ]);
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

  test("preserves the original explanation for each sizing view", () => {
    expect(explorerSizePhrase("targets")).toBe("how many targets it covers");
    expect(explorerSizePhrase("loss")).toBe("its share of the calibration loss");
    expect(explorerSizePhrase("error_intensity")).toBe(
      "its Huberized error intensity",
    );
  });
});
