import type { Country } from "@/components/layout/country-context";
import {
  countryCapabilities,
  type CountryCapability,
} from "@/lib/microcosm/countries";

// A page is shown when the country (or the release artifact, which can narrow
// a registration) serves its capability. Pages that run on country-specific
// data/runtimes (JCT scores, the PolicyEngine-US variable runtime, the staging
// repository) are granted only to the countries wired for them.
export interface NavItem {
  href: string;
  label: string;
  capability?: CountryCapability;
  external?: boolean;
  // Extra path prefixes that keep this item highlighted (drill-down views).
  also?: string[];
}

// Grouped by what the reader is doing: judging accuracy (the two validation
// legs, then the blind spots), managing releases, or looking things up.
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Dataset accuracy",
    items: [
      { href: "/microcosm", label: "Calibration fit", capability: "calibration" },
      { href: "/microcosm/targets", label: "Calibration targets", capability: "targets" },
      {
        href: "/microcosm/model-coverage",
        label: "Validation reach",
        capability: "model_coverage",
      },
      // External checks (reform scores vs JCT/fiscal notes/admin actuals)
      // moved to the PolicyEngine scorecard, which owns all external
      // comparisons; per-release history was ingested there (issue #15).
      { href: "/microcosm/datasets", label: "Cross-dataset", capability: "cross_dataset" },
      {
        href: "https://www.policyengine.org/scorecard",
        label: "External checks",
        capability: "external_checks",
        external: true,
      },
    ],
  },
  {
    label: "Releases",
    items: [
      { href: "/microcosm/compare", label: "Compare versions", capability: "compare" },
      { href: "/microcosm/staging", label: "Staging candidates", capability: "staging" },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/microcosm/pipeline", label: "Pipeline", capability: "pipeline" },
      { href: "/microcosm/variables", label: "Variable lookup", capability: "variables" },
    ],
  },
];

export function navGroupsForCountry(
  country: Country,
  capabilities: readonly CountryCapability[] = countryCapabilities(country),
) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.capability == null || capabilities.includes(item.capability),
    ),
  })).filter((group) => group.items.length > 0);
}

export function isActive(pathname: string, item: NavItem): boolean {
  const matches = (href: string) =>
    href === "/microcosm" ? pathname === "/microcosm" : pathname.startsWith(href);
  return matches(item.href) || (item.also ?? []).some((href) => pathname.startsWith(href));
}

export function navLinkAttributes(
  item: NavItem,
): { target?: "_blank"; rel?: "noopener noreferrer" } {
  const external = item.href.startsWith("https://") || item.href.startsWith("http://");
  return external ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

export function navItemHref(item: NavItem, country: Country): string {
  if (item.external || /^https?:\/\//.test(item.href)) return item.href;
  const separator = item.href.includes("?") ? "&" : "?";
  return `${item.href}${separator}country=${country}`;
}
