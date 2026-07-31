import type { Country } from "@/components/layout/country-context";

// usOnly pages run on US-specific data/runtimes (JCT scores, the PolicyEngine-US
// variable runtime) and aren't wired for UK yet.
export interface NavItem {
  href: string;
  label: string;
  usOnly?: boolean;
  // Extra path prefixes that keep this item highlighted (drill-down views).
  also?: string[];
}

// Grouped by what the reader is doing: judging accuracy (the two validation
// legs, then the blind spots), managing releases, or looking things up.
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Dataset accuracy",
    items: [
      { href: "/populace", label: "Calibration fit" },
      { href: "/populace/targets", label: "Calibration targets" },
      { href: "/populace/reforms", label: "External checks", usOnly: true },
      { href: "/populace/model-coverage", label: "Validation reach", usOnly: true },
    ],
  },
  {
    label: "Releases",
    items: [
      { href: "/populace/compare", label: "Compare versions" },
      { href: "/populace/staging", label: "Staging candidates", usOnly: true },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/populace/pipeline", label: "Pipeline", usOnly: true },
      { href: "/populace/variables", label: "Variable lookup", usOnly: true },
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
    href === "/populace" ? pathname === "/populace" : pathname.startsWith(href);
  return matches(item.href) || (item.also ?? []).some((href) => pathname.startsWith(href));
}
