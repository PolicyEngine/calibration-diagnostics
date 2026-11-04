import { describe, expect, test } from "bun:test";

import { levelFilterOptions, sourceFilterOptions } from "./target-filter-options";

describe("the targets page's Source and Level filters", () => {
  // The option's value stays the raw id the API filters on; only its label
  // changes.
  test("a source reads as the page names it, its value the raw id", () => {
    expect(
      sourceFilterOptions(
        ["census_population", "ed_fsa", "brand_new_source"],
        [
          { source: "census_population", source_label: "Census population" },
          // The release's own label wins over the dashboard's.
          { source: "irs_soi", source_label: "IRS SOI (from the release)" },
          { source: "ed_fsa", source_label: "" },
        ],
      ),
    ).toEqual([
      { value: "", label: "Any" },
      { value: "census_population", label: "Census population" },
      { value: "ed_fsa", label: "ED · Federal Student Aid" },
      { value: "brand_new_source", label: "Brand New Source" },
    ]);
    expect(
      sourceFilterOptions(["irs_soi"], [{ source: "irs_soi", source_label: "IRS SOI (from the release)" }]),
    ).toEqual([
      { value: "", label: "Any" },
      { value: "irs_soi", label: "IRS SOI (from the release)" },
    ]);
  });

  test("a level reads as the calibration map's filter names it", () => {
    expect(levelFilterOptions(["country", "national", "state"])).toEqual([
      { value: "", label: "Any" },
      { value: "country", label: "Country" },
      { value: "national", label: "National" },
      { value: "state", label: "State" },
    ]);
  });
});
