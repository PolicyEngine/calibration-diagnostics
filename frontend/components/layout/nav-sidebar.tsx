"use client";

import { SidebarSection, SidebarNavItem, SidebarDivider } from "@policyengine/ui-kit";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/targets", label: "Target Explorer" },
  { href: "/weights", label: "Weight Landscape" },
  { href: "/decompose", label: "Variable Decomposition" },
  { href: "/households", label: "Household Inspector" },
  { href: "/convergence", label: "Convergence" },
];

export function NavSidebar() {
  const pathname = usePathname();

  return (
    <div className="py-4">
      <SidebarSection>
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <SidebarNavItem
              key={item.href}
              label={item.label}
              href={item.href}
              isActive={isActive}
              linkComponent={Link}
            />
          );
        })}
      </SidebarSection>
    </div>
  );
}
