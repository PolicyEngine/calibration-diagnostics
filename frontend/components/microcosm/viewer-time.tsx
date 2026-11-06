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
// the server renders the page and while the browser hydrates it, so a time
// the server would format in its own zone (UTC on Vercel) never reaches the
// page or differs from the browser's first render.
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
  return (
    <time dateTime={new Date(ms).toISOString()} title={timeTitle(ms, zone)}>
      {children}
    </time>
  );
}
