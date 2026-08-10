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

  test("does not invent a link for an unmapped source package", () => {
    expect(chronicleSourceEntryUrl("unknown | Unmapped table")).toBeNull();
  });
});
