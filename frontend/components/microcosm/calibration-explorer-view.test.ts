import { describe, expect, test } from "bun:test";

import type { ExplorerState } from "../../lib/microcosm/calibration-explorer";
import {
  EXPLORER_MAP_VERTICAL_PADDING,
  explorerBreadcrumbs,
  explorerEmptyMessage,
  explorerGeographyLevelLabel,
  explorerMapHeight,
  explorerNodeLabel,
  explorerSizePhrase,
  explorerUpLabel,
} from "./calibration-explorer-view";

const EMPTY_FILTERS = {
  geographyLevels: [],
  geographies: [],
  fitBands: [],
  calibrationStatuses: [],
};

function state(
  path: ExplorerState["path"],
  filtered = false,
  breakdown: ExplorerState["breakdown"] = "program",
): ExplorerState {
  return {
    breakdown,
    path,
    filters: filtered
      ? { ...EMPTY_FILTERS, geographies: ["CA"] }
      : EMPTY_FILTERS,
  };
}

describe("calibration explorer presentation model", () => {
  test("subtracts the measured navbar and page intro from the map window", () => {
    expect(EXPLORER_MAP_VERTICAL_PADDING).toBe(10);
    expect(explorerMapHeight(136)).toBe(
      "max(0px, calc(100dvh - var(--site-header-height) - 136px))",
    );
    expect(explorerMapHeight(188)).toBe(
      "max(0px, calc(100dvh - var(--site-header-height) - 188px))",
    );
  });

  test("resolves program labels at the final presentation boundary", () => {
    expect(
      explorerNodeLabel({
        id: "taxable interest income",
        label: "taxable interest income",
        kind: "program",
      }),
    ).toBe("Taxable interest income");
    expect(
      explorerNodeLabel({
        id: "refundable ctc",
        label: "refundable ctc",
        kind: "program",
      }),
    ).toBe("Refundable CTC");
    expect(
      explorerNodeLabel({
        id: "traditional ira deduction",
        label: "traditional ira deduction",
        kind: "dimension_value",
      }),
    ).toBe("Traditional IRA deduction");
    expect(
      explorerNodeLabel({
        id: "target-1",
        label: "Published target label",
        kind: "target",
      }),
    ).toBe("Published target label");
  });

  test("capitalizes geography levels in filter labels", () => {
    expect(explorerGeographyLevelLabel("national")).toBe("National");
    expect(explorerGeographyLevelLabel("state")).toBe("State");
  });

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

  test("labels the missing sentinel consistently and supports geography-less dimensions", () => {
    expect(
      explorerBreadcrumbs(
        state({
          source: "irs_soi",
          program: "ctc",
          geography: "__missing__",
          dimensions: [],
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({ label: "Not specified" }),
    );

    expect(
      explorerBreadcrumbs(
        state({
          source: "test",
          program: "geographyless program",
          dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
        }),
      ).at(-1),
    ).toEqual({
      label: "Adult",
      path: {
        source: "test",
        program: "geographyless program",
        dimensions: [{ key: "bd_age", label: "Age", value: "Adult" }],
      },
    });
  });

  test("orders navigation for a geography-first journey", () => {
    const geography = state(
      { geography: "CA", dimensions: [] },
      false,
      "geography",
    );
    const program = state(
      {
        source: "irs_soi",
        program: "ctc",
        geography: "CA",
        dimensions: [],
      },
      false,
      "geography",
    );

    expect(explorerUpLabel(geography)).toBe("Up to all geographies");
    expect(explorerUpLabel(program)).toBe("Up to all programs");
    expect(explorerBreadcrumbs(program)).toEqual([
      { label: "All targets", path: { dimensions: [] } },
      { label: "CA", path: { geography: "CA", dimensions: [] } },
      {
        label: "IRS Statistics of Income",
        path: { geography: "CA", dimensions: [] },
      },
      {
        label: "CTC",
        path: {
          source: "irs_soi",
          program: "ctc",
          geography: "CA",
          dimensions: [],
        },
      },
    ]);
  });

  test("uses canonical program labels without changing navigation keys", () => {
    expect(
      explorerBreadcrumbs(
        state({
          source: "irs_soi",
          program: "taxable interest income",
          geography: "CA",
          dimensions: [],
        }),
      ),
    ).toContainEqual({
      label: "Taxable interest income",
      path: {
        source: "irs_soi",
        program: "taxable interest income",
        dimensions: [],
      },
    });
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
