"use client";

import { SidebarSection, SidebarNavItem } from "@policyengine/ui-kit";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Summary" },
  { href: "/targets", label: "All targets" },
  { href: "/inventory", label: "Target inventory" },
  { href: "/weights", label: "Weight landscape" },
  { href: "/pipeline", label: "Data pipeline" },
];

export function NavSidebar() {
  const pathname = usePathname();

  return (
    <div className="py-4 flex flex-col gap-4">
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
