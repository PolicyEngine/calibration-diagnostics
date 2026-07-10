"use client";

import { GlobalLoader } from "./global-loader";
import { NavSidebar } from "./nav-sidebar";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

// The dashboard chrome, skinned to populace.dev. We deliberately do NOT use
// ui-kit's <DashboardShell>/<Header> here: the shell paints an opaque bg-muted
// that would hide the body's paper wash + grain, and the header read as a hard
// exit from populace.dev. The shell stays transparent so the site atmosphere
// (app/globals.css body::before + .site-grain) shows through, and the header /
// footer come from the populace.dev-style components.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <GlobalLoader />
      <SiteHeader />
      <div className="flex h-[calc(100vh-4rem)]">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border-light bg-card/50 backdrop-blur-sm">
          <NavSidebar />
        </aside>
        <main className="flex flex-1 flex-col overflow-auto">
          <div className="flex-1 p-6 pt-0">{children}</div>
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
