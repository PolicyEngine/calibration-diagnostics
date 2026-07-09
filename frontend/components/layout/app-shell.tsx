"use client";

import { DashboardShell, Header } from "@policyengine/ui-kit";
import { withBasePath } from "@/lib/base-path";
import { GlobalLoader } from "./global-loader";
import { NavSidebar } from "./nav-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      <GlobalLoader />
      {/* ui-kit Header renders logoHref as a raw <a> when no linkComponent is
          passed, so the basePath must be applied explicitly here. */}
      <Header navItems={[]} logoHref={withBasePath("/populace")} />
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
