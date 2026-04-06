"use client";

import { SidebarSection, SidebarNavItem, SidebarDivider } from "@policyengine/ui-kit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GeoSelector } from "@/components/shared/geo-selector";
import { useGeo } from "@/lib/geo-context";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/targets", label: "Target explorer" },
  { href: "/weights", label: "Weight landscape" },
  { href: "/decompose", label: "Variable decomposition" },
  { href: "/households", label: "Household inspector" },
  { href: "/convergence", label: "Convergence" },
];

export function NavSidebar() {
  const pathname = usePathname();
  const { geo, setGeo } = useGeo();

  return (
    <div className="py-4 flex flex-col gap-4">
      <div className="px-3">
        <GeoSelector value={geo} onChange={setGeo} />
      </div>
      <SidebarDivider />
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
