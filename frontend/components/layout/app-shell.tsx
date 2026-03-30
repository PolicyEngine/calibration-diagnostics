"use client";

import { DashboardShell, Header } from "@policyengine/ui-kit";
import { NavSidebar } from "./nav-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      <Header variant="dark" logo={<span className="text-white font-bold">PolicyEngine</span>} />
      <div className="flex min-h-[calc(100vh-3.5rem)]">
        <aside className="w-48 shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-border bg-muted/30">
          <NavSidebar />
        </aside>
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </DashboardShell>
  );
}
