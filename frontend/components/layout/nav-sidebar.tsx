"use client";

import { SidebarSection, SidebarNavItem } from "@policyengine/ui-kit";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboardMode } from "@/lib/dashboard-mode-context";
import { DashboardModeSelector } from "./dashboard-mode-selector";

const usDataNavItems = [
  { href: "/summary", label: "Summary" },
  { href: "/analysis", label: "Analyst readiness" },
  { href: "/targets", label: "All targets" },
  { href: "/inventory", label: "Target inventory" },
  { href: "/nodes", label: "Node variables" },
  { href: "/weights", label: "Weight landscape" },
  { href: "/pipeline", label: "Data pipeline" },
];

const microplexNavItems = [
  { href: "/microplex", label: "Overview" },
  { href: "/budget-impact", label: "Budget impact" },
  { href: "/pipeline", label: "Pipeline" },
];

const comparisonNavItems = [
  { href: "/comparison", label: "Comparison" },
  { href: "/microplex", label: "Microplex target performance" },
  { href: "/budget-impact", label: "Budget impact" },
  { href: "/summary", label: "us-data summary" },
  { href: "/pipeline", label: "Pipeline DAG" },
];

export function NavSidebar() {
  const pathname = usePathname();
  const { mode } = useDashboardMode();
  const navItems =
    mode === "microplex"
      ? microplexNavItems
      : mode === "comparison"
        ? comparisonNavItems
        : usDataNavItems;

  return (
    <div className="py-4 flex flex-col gap-4">
      <DashboardModeSelector />
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
