"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useCountry } from "@/components/layout/country-context";
import { activeNavItem, navGroupsForCountry } from "@/components/layout/nav-items";
import { countryRegistration } from "@policyengine/calibration-tree/countries";

import { NavSidebar } from "./nav-sidebar";

// Below the md breakpoint the sidebar would take most of a phone's width, so
// AppShell hides it and renders this bar instead: a menu button that drops the
// same NavSidebar over the page, beside the dataset and page the reader is on.
export function MobileNav() {
  const pathname = usePathname();
  const { country } = useCountry();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Keyed by pathname so the menu closes on any route change (a link, or
  // back/forward) without an effect. A country switch keeps the pathname, so
  // the menu stays open for the reader to pick a page next.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const close = () => setOpenOn(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenOn(null);
      buttonRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const current = activeNavItem(pathname, navGroupsForCountry(country));

  return (
    <div className="relative z-30 flex h-11 shrink-0 items-center gap-3 border-b border-border-light bg-card/50 px-4 backdrop-blur-sm md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenOn(open ? null : pathname)}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 font-mono text-xs font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          open ? "bg-muted" : "bg-background/60 hover:bg-muted/60"
        }`}
      >
        <MenuIcon open={open} />
        Menu
      </button>
      <div className="min-w-0 truncate font-mono text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{country.toUpperCase()}</span>
        <span aria-hidden="true"> · </span>
        {current?.label ?? countryRegistration(country).dataset_label}
      </div>
      {open ? (
        <div
          aria-hidden="true"
          onClick={close}
          className="absolute inset-x-0 top-full h-dvh bg-[var(--scrim)]"
        />
      ) : null}
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh_-_var(--site-header-height)_-_2.75rem)] overflow-y-auto border-b border-border-light bg-card px-1 shadow-[var(--elev-2)]"
      >
        <NavSidebar onNavigate={close} />
      </div>
    </div>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {open ? <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /> : <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />}
    </svg>
  );
}
