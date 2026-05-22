"use client";

import { DashboardShell, Header } from "@policyengine/ui-kit";
import { GlobalLoader } from "./global-loader";
import { NavSidebar } from "./nav-sidebar";
import { RunPicker } from "./run-picker";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      <GlobalLoader />
      {/* Run selector sits above the gradient header so it's the first thing
          users see in the top-left — switching dataset/version is the most
          frequent action and should never be hidden. */}
      <div className="flex items-center gap-4 border-b border-border bg-background px-6 py-2">
        <RunPicker />
      </div>
      <Header navItems={[]} logoHref="/" />
      <div className="flex min-h-[calc(100vh-7rem)]">
        <aside className="w-56 shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-border bg-muted/30">
          <NavSidebar />
        </aside>
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </DashboardShell>
  );
}
