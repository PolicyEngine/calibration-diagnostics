// Canonical labels for the authorities behind calibration targets. Keep this
// shared between the legacy aggregate map and the drillable explorer so raw
// source IDs never leak into either UI.
const SOURCE_LABELS: Record<string, string> = {
  cbo: "CBO",
  census_population: "Census population",
  cms_aca: "CMS · ACA marketplace",
  cms_medicaid: "CMS · Medicaid / CHIP",
  cms_medicare: "CMS · Medicare",
  hhs_acf_tanf: "HHS · TANF",
  irs_soi: "IRS Statistics of Income",
  jct: "JCT",
  ssa: "SSA",
  state_income_tax: "State income tax",
  usda_snap: "USDA · SNAP",
};

export function sourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  return source
    .split("_")
    .map((word) =>
      word.length <= 3
        ? word.toUpperCase()
        : word[0].toUpperCase() + word.slice(1),
    )
    .join(" ");
}
