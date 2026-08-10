const CHRONICLE_SOURCES_BASE_URL = "https://chronicle.institute/sources";

const PACKAGE_BY_SOURCE_TABLE: Readonly<Record<string, string>> = {
  "2024 oep state-level public use file": "cms-aca-oep-state-level",
  "2025 medicare trustees report table iii.c3":
    "cms-medicare-trustees-report-2025-part-b-premium-income",
  "annual state resident population estimates by single year of age, sex, race, and hispanic origin":
    "census-pep-2024-state-age-sex",
  "estimates of federal tax expenditures for fiscal years 2024-2028":
    "jct-tax-expenditures-2024",
  "fy 2024 federal tanf and state moe financial data": "hhs-acf-tanf-financial-2024",
  "fy2023 stc flat file item t40 individual income taxes":
    "census-stc-individual-income-tax",
  "historic table 2 state agi facts": "soi-historic-table-2-state-agi-2022",
  "historic table 2 state broad totals": "soi-historic-table-2-state-broad-2022",
  "historic table 2 state eitc totals": "soi-historic-table-2-state-eitc-2022",
  "liheap fy2024 national profile (all states)": "hhs-acf-liheap-fy2024-national-profile",
  "revenue projections, by category, february 2026, sheet 3.individual income tax details":
    "cbo-revenue-projections-income-by-source-2026-02",
  "snap monthly state participation and benefit summary fy69 to current":
    "usda-snap-fy69-to-current",
  "state medicaid and chip applications, eligibility determinations, and enrollment data":
    "cms-medicaid-chip-monthly-enrollment-december-2024",
  "z.1 b.101 households and nonprofit organizations":
    "federal-reserve-z1-household-net-worth",
};

function packageFromRecordSet(recordSet: string | null | undefined): string | null {
  const normalized = recordSet?.trim().toLowerCase() ?? "";
  if (normalized.includes("bea_nipa.cy2024.total_wages_salaries")) {
    return "bea-nipa-total-wages-salaries";
  }
  if (normalized.includes("bea_nipa.cy2023.proprietors_income")) {
    return "bea-nipa-personal-income-components";
  }
  return null;
}

export function chronicleSourceEntryUrl(
  sourceCitation: string | null | undefined,
  recordSet?: string | null,
): string | null {
  const packageId =
    packageFromRecordSet(recordSet) ??
    PACKAGE_BY_SOURCE_TABLE[sourceCitation?.split("|")[1]?.trim().toLowerCase() ?? ""];
  return packageId ? `${CHRONICLE_SOURCES_BASE_URL}/${packageId}` : null;
}
