import { describe, expect, test } from "bun:test";

import { chronicleSourceEntryUrl } from "./chronicle-entry-url";

describe("chronicleSourceEntryUrl", () => {
  test("builds a source entry URL from a published citation", () => {
    expect(
      chronicleSourceEntryUrl(
        "irs_soi | Historic Table 2 state AGI facts | 22in55cmcsv.csv | tax_year_2022",
      ),
    ).toBe(
      "https://chronicle.institute/sources/soi-historic-table-2-state-agi-2022",
    );
  });

  test("uses record-set detail to disambiguate a shared source table", () => {
    expect(
      chronicleSourceEntryUrl(
        "bea | BEA NIPA annual data flat file | NipaDataA.txt",
        "bea_nipa.cy2024.total_wages_salaries",
      ),
    ).toBe("https://chronicle.institute/sources/bea-nipa-total-wages-salaries");
  });

  test.each([
    [
      "irs_soi | Publication 1304 Table 2.5 EITC by AGI and qualifying children | 23in25ic.xls",
      "soi-table-2-5-eitc-agi-children-2023",
    ],
    [
      "ssa | SSA Annual Statistical Supplement 2025 Table 7.B1 | ssi_table_7b1_2024.csv",
      "ssa-ssi-table-7b1-2024",
    ],
    [
      "irs_soi | Historic Table 2 state data, United States total | 22in54us.xlsx",
      "soi-state-2022",
    ],
    [
      "census_pep | Annual Estimates of the Resident Population by Single Year of Age and Sex for the United States | nc-est2024-agesex-res.csv",
      "census-pep-2024-national-age-sex",
    ],
    ["Publication 1304 Table 1.1", "soi-table-1-1"],
    ["IRS SOI Table 1.1", "soi-table-1-1"],
    ["IRS SOI Publication 1304 Table 1.1", "soi-table-1-1"],
  ])("maps current source catalog entries to Chronicle (%s)", (citation, packageId) => {
    expect(chronicleSourceEntryUrl(citation)).toBe(
      `https://chronicle.institute/sources/${packageId}`,
    );
  });

  test.each([
    [
      "irs_soi | Publication 1304 Table 2.5 EITC by AGI and qualifying children | 22in25ic.xls | tax_year_2022",
      "soi-table-2-5-eitc-agi-children-2022",
    ],
    [
      "irs_soi | Publication 1304 Table 2.5 EITC by AGI and qualifying children | 23in25ic.xls | tax_year_2023",
      "soi-table-2-5-eitc-agi-children-2023",
    ],
  ])("preserves the source vintage when resolving Chronicle (%s)", (citation, packageId) => {
    expect(chronicleSourceEntryUrl(citation)).toBe(
      `https://chronicle.institute/sources/${packageId}`,
    );
  });

  test("does not guess a package when a versioned source omits its vintage", () => {
    expect(
      chronicleSourceEntryUrl(
        "Publication 1304 Table 2.5 EITC by AGI and qualifying children",
      ),
    ).toBeNull();
  });

  test("does not invent a link for an unmapped source package", () => {
    expect(chronicleSourceEntryUrl("unknown | Unmapped table")).toBeNull();
  });

  test("leaves a source without a Chronicle package unlinked", () => {
    expect(
      chronicleSourceEntryUrl(
        "ssa | SSI Monthly Statistics, December 2024, Table 1 | ssi_monthly_2024_12_table01.csv",
      ),
    ).toBeNull();
  });
});
