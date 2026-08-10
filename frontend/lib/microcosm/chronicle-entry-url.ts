const CHRONICLE_SOURCES_BASE_URL = "https://chronicle.institute/sources";

const PACKAGE_BY_SOURCE_TABLE: Readonly<Record<string, string>> = {
  "2024 oep state-level public use file": "cms-aca-oep-state-level",
  "2025 medicare trustees report table iii.c3":
    "cms-medicare-trustees-report-2025-part-b-premium-income",
  "annual estimates of the resident population by single year of age and sex for the united states":
    "census-pep-2024-national-age-sex",
  "annual state resident population estimates by single year of age, sex, race, and hispanic origin":
    "census-pep-2024-state-age-sex",
  "estimates of federal tax expenditures for fiscal years 2024-2028":
    "jct-tax-expenditures-2024",
  "filing season statistics table 1": "soi-filing-season-week47-2024-eitc-total",
  "fy 2024 federal tanf and state moe financial data": "hhs-acf-tanf-financial-2024",
  "fy2023 stc flat file item t40 individual income taxes":
    "census-stc-individual-income-tax",
  "historic table 2": "soi-historic-table-2",
  "historic table 2 state agi facts": "soi-historic-table-2-state-agi-2022",
  "historic table 2 state broad totals": "soi-historic-table-2-state-broad-2022",
  "historic table 2 state data, united states total": "soi-state-2022",
  "historic table 2 state eitc totals": "soi-historic-table-2-state-eitc-2022",
  "liheap fy2024 national profile (all states)": "hhs-acf-liheap-fy2024-national-profile",
  "publication 1304 table 1.1": "soi-table-1-1",
  "publication 1304 table 1.2": "soi-table-1-2",
  "publication 1304 table 1.4": "soi-table-1-4",
  "publication 1304 table 2.1": "soi-table-2-1",
  "publication 1304 table 2.5": "soi-table-2-5",
  "publication 1304 table 4.3": "soi-table-4-3",
  "revenue projections, by category, february 2026, sheet 3.individual income tax details":
    "cbo-revenue-projections-income-by-source-2026-02",
  "snap monthly state participation and benefit summary fy69 to current":
    "usda-snap-fy69-to-current",
  "ssa annual statistical supplement 2025 extracted oasdi and ssi target rows":
    "ssa-annual-statistical-supplement-2025",
  "ssa annual statistical supplement 2025 table 7.b1": "ssa-ssi-table-7b1-2024",
  "state medicaid and chip applications, eligibility determinations, and enrollment data":
    "cms-medicaid-chip-monthly-enrollment-december-2024",
  "table 4.b. summary of items for taxpayers with form w-2, by return and earner type, tax year 2020":
    "soi-w2-statistics-2020",
  "z.1 b.101 households and nonprofit organizations":
    "federal-reserve-z1-household-net-worth",
};

const PACKAGE_BY_SOURCE_TABLE_AND_YEAR: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "publication 1304 table 2.5 eitc by agi and qualifying children": {
    "2022": "soi-table-2-5-eitc-agi-children-2022",
    "2023": "soi-table-2-5-eitc-agi-children-2023",
  },
};

function canonicalSourceTable(sourceTable: string | undefined): string {
  const normalized = sourceTable?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return normalized
    .replace(/^irs soi publication 1304 /, "publication 1304 ")
    .replace(/^irs soi table /, "publication 1304 table ");
}

function sourceYear(sourceCitation: string | null | undefined): string | null {
  const taxYear = sourceCitation?.match(/\btax_year[_\s-]*(20\d{2})\b/i)?.[1];
  if (taxYear) return taxYear;

  const irsFileYear = sourceCitation?.match(/\b(\d{2})in\d+[a-z]*\b/i)?.[1];
  return irsFileYear ? `20${irsFileYear}` : null;
}

function packageFromSourceCitation(
  sourceCitation: string | null | undefined,
): string | null {
  const citationParts = sourceCitation?.split("|") ?? [];
  const sourceTable = canonicalSourceTable(
    citationParts.length > 1 ? citationParts[1] : citationParts[0],
  );
  const versionedPackages = PACKAGE_BY_SOURCE_TABLE_AND_YEAR[sourceTable];
  if (versionedPackages) {
    const year = sourceYear(sourceCitation);
    return year ? versionedPackages[year] ?? null : null;
  }
  return PACKAGE_BY_SOURCE_TABLE[sourceTable] ?? null;
}

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
    packageFromSourceCitation(sourceCitation);
  return packageId ? `${CHRONICLE_SOURCES_BASE_URL}/${packageId}` : null;
}
