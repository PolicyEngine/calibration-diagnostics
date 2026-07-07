"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCountry, type Country } from "@/components/layout/country-context";

const DATASET: Record<Country, { label: string; repo: string }> = {
  us: { label: "Populace US", repo: "policyengine/populace-us" },
  uk: { label: "Populace UK", repo: "policyengine/populace-uk" },
};

// usOnly pages run on US-specific data/runtimes (JCT scores, the PolicyEngine-US
// variable runtime) and aren't wired for UK yet.
interface NavItem {
  href: string;
  label: string;
  usOnly?: boolean;
  // Extra path prefixes that keep this item highlighted (drill-down views).
  also?: string[];
}

// Grouped by what the reader is doing: judging accuracy (the two validation
// legs, then the blind spots), managing releases, or looking things up.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Dataset accuracy",
    items: [
      { href: "/populace", label: "Calibration fit", also: ["/populace/targets"] },
      { href: "/populace/reforms", label: "External checks", usOnly: true },
      { href: "/populace/model-coverage", label: "Validation reach", usOnly: true },
      { href: "/populace/datasets", label: "Cross-dataset", usOnly: true },
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

function isActive(pathname: string, item: NavItem): boolean {
  const matches = (href: string) =>
    href === "/populace" ? pathname === "/populace" : pathname.startsWith(href);
  return matches(item.href) || (item.also ?? []).some((href) => pathname.startsWith(href));
}

export function NavSidebar() {
  const pathname = usePathname();
  const { country, setCountry } = useCountry();
  const dataset = DATASET[country];
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => country === "us" || !item.usOnly),
  })).filter((group) => group.items.length > 0);
  return (
    <div className="flex flex-col gap-5 py-5">
      <div className="px-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Dataset
        </div>
        <div
          role="tablist"
          aria-label="Country"
          className="mt-1.5 inline-flex rounded-lg bg-muted p-0.5"
        >
          {(["us", "uk"] as const).map((value) => {
            const active = country === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCountry(value)}
                className={`h-7 rounded-md px-3 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {value.toUpperCase()}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-sm font-semibold text-foreground">{dataset.label}</div>
        <div className="text-xs text-muted-foreground">{dataset.repo}</div>
      </div>
      <nav className="flex flex-col gap-4 px-3">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-md px-3 py-1.5 text-sm leading-tight transition-colors ${
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
