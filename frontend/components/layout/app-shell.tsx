"use client";

import { DashboardShell, Header } from "@policyengine/ui-kit";
import { GlobalLoader } from "./global-loader";
import { NavSidebar } from "./nav-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      <GlobalLoader />
      <Header navItems={[]} logoHref="/" />
      <div className="flex h-[calc(100vh-4rem)]">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-muted/30">
          <NavSidebar />
        </aside>
        <main className="flex-1 overflow-auto p-6 pt-0">
          {children}
        </main>
      </div>
    </DashboardShell>
  );
}
