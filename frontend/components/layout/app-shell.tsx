"use client";

import { GlobalLoader } from "./global-loader";
import { useCountry } from "./country-context";
import { MobileNav } from "./mobile-nav";
import { NavSidebar } from "./nav-sidebar";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

// The dashboard chrome, skinned to microcosm.institute. We deliberately do NOT use
// ui-kit's <DashboardShell>/<Header> here: the shell paints an opaque bg-muted
// that would hide the body's paper wash + grain, and the header read as a hard
// exit from microcosm.institute. The shell stays transparent so the site atmosphere
// (app/globals.css body::before + .site-grain) shows through, and the header /
// footer come from the microcosm.institute-style components.
//
// Below md the sidebar gives way to <MobileNav>, a one-line bar whose menu
// opens the same nav, so phone-width content keeps the full width with a 16 px
// gutter. From md up the layout is the sidebar + 24 px content padding.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { country } = useCountry();
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden text-foreground">
      <GlobalLoader />
      <SiteHeader />
      <MobileNav />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden min-h-0 w-56 shrink-0 overflow-y-auto border-r border-border-light bg-card/50 backdrop-blur-sm md:block">
          <NavSidebar />
        </aside>
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div key={country} className="flex-1 px-4 pb-6 md:px-6">{children}</div>
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
