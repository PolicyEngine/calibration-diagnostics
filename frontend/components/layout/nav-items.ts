import type { Country } from "@/components/layout/country-context";

// usOnly pages run on US-specific data/runtimes (JCT scores, the PolicyEngine-US
// variable runtime) and aren't wired for UK yet.
export interface NavItem {
  href: string;
  label: string;
  usOnly?: boolean;
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
      { href: "/microcosm", label: "Calibration fit" },
      { href: "/microcosm/targets", label: "Calibration targets" },
      { href: "/microcosm/model-coverage", label: "Validation reach", usOnly: true },
      // External checks (reform scores vs JCT/fiscal notes/admin actuals)
      // moved to the PolicyEngine scorecard, which owns all external
      // comparisons; per-release history was ingested there (issue #15).
      {
        href: "https://www.policyengine.org/scorecard",
        label: "External checks",
        usOnly: true,
        external: true,
      },
    ],
  },
  {
    label: "Releases",
    items: [
      { href: "/microcosm/compare", label: "Compare versions" },
      { href: "/microcosm/staging", label: "Staging candidates", usOnly: true },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/microcosm/pipeline", label: "Pipeline", usOnly: true },
      { href: "/microcosm/variables", label: "Variable lookup", usOnly: true },
    ],
  },
];

export function navGroupsForCountry(country: Country) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => country === "us" || !item.usOnly),
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
