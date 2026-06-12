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
  { href: "/microplex/diagnostics", label: "Target diagnostics" },
  { href: "/microplex/reforms", label: "Reform benchmarks" },
  { href: "/pipeline", label: "Pipeline" },
];

const populaceNavItems = [
  { href: "/populace", label: "Release summary" },
  { href: "/populace/targets", label: "Target diagnostics" },
];

const comparisonNavItems = [
  { href: "/comparison", label: "Comparison" },
  { href: "/microplex", label: "Microplex target performance" },
  { href: "/microplex/reforms", label: "Reform benchmarks" },
  { href: "/summary", label: "us-data summary" },
  { href: "/pipeline", label: "Pipeline DAG" },
];

export function NavSidebar() {
  const pathname = usePathname();
  const { mode } = useDashboardMode();
  const navItems =
    mode === "microplex"
      ? microplexNavItems
      : mode === "populace"
        ? populaceNavItems
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
              : item.href === "/microplex"
                ? pathname === "/microplex"
                : item.href === "/populace"
                  ? pathname === "/populace"
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
