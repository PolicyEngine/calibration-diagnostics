"use client";

import { DashboardShell, Header } from "@policyengine/ui-kit";
import { CurrentRunBadge } from "./current-run-badge";
import { GlobalLoader } from "./global-loader";
import { NavSidebar } from "./nav-sidebar";
import { RunBootstrap } from "./run-bootstrap";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      <GlobalLoader />
      <RunBootstrap />
      <Header navItems={[]} logoHref="/" />
      <div className="flex min-h-[calc(100vh-4rem)]">
        <aside className="w-56 shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-border bg-muted/30">
          <div className="px-3 py-3 border-b border-border">
            <CurrentRunBadge />
          </div>
          <NavSidebar />
        </aside>
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </DashboardShell>
  );
}
