"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/populace", label: "Release summary" },
  { href: "/populace/targets", label: "Target diagnostics" },
  { href: "/populace/variables", label: "Variable lookup" },
  { href: "/populace/compare", label: "Compare versions" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/populace") return pathname === "/populace";
  return pathname.startsWith(href);
}

export function NavSidebar() {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-5 py-5">
      <div className="px-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Dataset
        </div>
        <div className="text-sm font-semibold text-foreground">Populace US</div>
        <div className="text-xs text-muted-foreground">policyengine/populace-us</div>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {navItems.map((item) => {
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
