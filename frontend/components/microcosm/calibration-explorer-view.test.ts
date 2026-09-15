import { describe, expect, test } from "bun:test";

import type { ExplorerState } from "../../lib/microcosm/calibration-explorer";
import {
  EXPLORER_MAP_VERTICAL_PADDING,
  explorerBreadcrumbs,
  explorerColorLegendLabel,
  explorerColorMetric,
  explorerColorPhrase,
  explorerEmptyMessage,
  explorerGeographyLevelLabel,
  explorerMapHeight,
  explorerNodeLabel,
  explorerSizePhrase,
  explorerLossAvailabilityMessage,
  explorerUpLabel,
  WEIGHTED_MEAN_ERROR_HELP,
  WEIGHTED_TARGET_ERROR_HELP,
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

  test("uses the program label resolved by the tree", () => {
    expect(
      explorerNodeLabel({
        id: "taxable interest income",
        label: "Taxable interest income",
        kind: "program",
      }),
    ).toBe("Taxable interest income");
    expect(
      explorerNodeLabel({
        id: "refundable ctc",
        label: "Refundable CTC",
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
        id: "income_tax",
        label: "Income TAX (GBP) — authored",
        kind: "dimension_value",
        authored_label: true,
      }),
    ).toBe("Income TAX (GBP) — authored");
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

  test("labels the national fallback and supports geography-less dimensions", () => {
    expect(
      explorerBreadcrumbs(
        state({
          source: "irs_soi",
          program: "ctc",
          geography: "United States",
          dimensions: [],
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({ label: "United States" }),
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

  test("prefers artifact source and category labels in breadcrumbs", () => {
    expect(
      explorerBreadcrumbs(
        state({
          source: "obr",
          program: "efo_receipts",
          geography: "United Kingdom — authored",
          dimensions: [],
        }),
        {
          source: "Office for Budget Responsibility",
          program: "EFO receipts",
          geography: "United Kingdom — authored",
        },
      ),
    ).toEqual([
      { label: "All targets", path: { dimensions: [] } },
      {
        label: "Office for Budget Responsibility",
        path: { dimensions: [] },
      },
      {
        label: "EFO receipts",
        path: {
          source: "obr",
          program: "efo_receipts",
          dimensions: [],
        },
      },
      {
        label: "United Kingdom — authored",
        path: {
          source: "obr",
          program: "efo_receipts",
          geography: "United Kingdom — authored",
          dimensions: [],
        },
      },
    ]);
  });

  test("uses schema 8 value labels instead of formatting navigation ids", () => {
    const current = state({
      source: "obr",
      program: "obr.efo_receipts",
      geography: "United Kingdom",
      dimensions: [
        {
          key: "obr.efo_line",
          label: "Economic and fiscal outlook line",
          value: "income_tax",
        },
      ],
    });

    expect(
      explorerBreadcrumbs(current, {
        source: "Office for Budget Responsibility",
        program: "Economic and fiscal outlook receipts",
        dimensions: ["Income tax (gross of tax credits)"],
      }).at(-1)?.label,
    ).toBe("Income tax (gross of tax credits)");
  });

  test("preserves an artifact category label on a program tile", () => {
    expect(
      explorerNodeLabel({
        id: "efo_receipts",
        kind: "program",
        label: "EFO receipts",
      }),
    ).toBe("EFO receipts");
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
    expect(explorerSizePhrase("weight")).toBe("its share of total target weight");
    expect(explorerSizePhrase("loss")).toBe("its share of weighted target error");
  });

  test("colors both attribution views by importance-weighted capped error", () => {
    const metrics = {
      medianAbsRelativeError: 1.55,
      weightedAverageCappedError: 0.19,
    };

    expect(explorerColorMetric("loss", metrics)).toBe(0.19);
    expect(explorerColorMetric("weight", metrics)).toBe(0.19);
    expect(explorerColorLegendLabel("loss")).toBe("Weighted mean error");
    expect(explorerColorPhrase("loss")).toContain("importance-weighted");
    expect(explorerColorMetric("targets", metrics)).toBe(1.55);
  });

  test("explains both weighted-error concepts in exactly two sentences", () => {
    expect(WEIGHTED_TARGET_ERROR_HELP.split(". ")).toHaveLength(2);
    expect(WEIGHTED_MEAN_ERROR_HELP.split(". ")).toHaveLength(2);
    expect(WEIGHTED_TARGET_ERROR_HELP).toContain("box area");
    expect(WEIGHTED_MEAN_ERROR_HELP).toContain("Redder boxes");
  });

  test("uses an ordinary unavailable message without attribution provenance", () => {
    expect(explorerLossAvailabilityMessage(true)).toBeNull();
    expect(explorerLossAvailabilityMessage(false)).toBe(
      "Target weight and weighted target error are unavailable for this calibration.",
    );
    expect(explorerLossAvailabilityMessage(false)).not.toMatch(
      /reported|reconstructed|derived|recipe|hash/i,
    );
  });
});
