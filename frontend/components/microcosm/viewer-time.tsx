"use client";

import { type ReactNode, useSyncExternalStore } from "react";

import { browserZone, timeTitle, type ViewerZone } from "@/lib/microcosm/viewer-time";

let browserZoneSnapshot: ViewerZone | null = null;

function browserZoneOnce(): ViewerZone {
  browserZoneSnapshot ??= browserZone();
  return browserZoneSnapshot;
}

function noZoneOnServer(): null {
  return null;
}

// The browser's zone does not change while the page is open, so there is
// nothing to subscribe to.
function subscribeToNothing(): () => void {
  return () => {};
}

// The zone the page's times are shown in: the browser's. It is null while
// the server renders the page and while the browser hydrates it, so the zone
// note (the one zone-dependent text that needs no data) is left out of the
// server's HTML and hydration matches. A null zone formats times in the
// runtime's default zone, which on the server is UTC on Vercel; the Staging
// page shows no time before its data arrives, and its data is fetched in the
// browser, so no time is formatted on the server today.
export function useViewerZone(): ViewerZone | null {
  return useSyncExternalStore(subscribeToNothing, browserZoneOnce, noZoneOnServer);
}

// A displayed time. Hovering over it shows the time in full in the viewer's
// zone and in UTC, the zone run IDs end in.
export function ViewerTime({
  ms,
  zone,
  children,
}: {
  ms: number;
  zone: ViewerZone | null;
  children: ReactNode;
}) {
  if (!Number.isFinite(ms)) return <>{children}</>;
  return (
    <time dateTime={new Date(ms).toISOString()} title={timeTitle(ms, zone)}>
      {children}
    </time>
  );
}
