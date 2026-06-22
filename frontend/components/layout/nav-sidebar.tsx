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
const navItems = [
  { href: "/populace", label: "Release summary" },
  { href: "/populace/targets", label: "Target diagnostics" },
  { href: "/populace/variables", label: "Variable lookup", usOnly: true },
  { href: "/populace/reforms", label: "Reform validation", usOnly: true },
  { href: "/populace/compare", label: "Compare versions" },
  { href: "/populace/staging", label: "Staging runs", usOnly: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/populace") return pathname === "/populace";
  return pathname.startsWith(href);
}

export function NavSidebar() {
  const pathname = usePathname();
  const { country, setCountry } = useCountry();
  const dataset = DATASET[country];
  const items = navItems.filter((item) => country === "us" || !item.usOnly);
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
      <nav className="flex flex-col gap-0.5 px-3">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
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
      </nav>
    </div>
  );
}
