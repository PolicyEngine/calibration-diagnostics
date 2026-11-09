"use client";

import { type ReactNode, useSyncExternalStore } from "react";

import { browserZone, type ViewerZone } from "@/lib/microcosm/viewer-time";

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
// the server renders the page and while the browser hydrates it, because the
// server cannot know the browser's zone. A null zone formats times in the
// runtime's default zone, with no zone name; the Staging page shows no time
// before its data arrives, and its data is fetched in the browser, so no time
// is formatted on the server today.
export function useViewerZone(): ViewerZone | null {
  return useSyncExternalStore(subscribeToNothing, browserZoneOnce, noZoneOnServer);
}

// A displayed time, marked up with the moment it stands for.
export function ViewerTime({ ms, children }: { ms: number; children: ReactNode }) {
  if (!Number.isFinite(ms)) return <>{children}</>;
  return (
    <time dateTime={new Date(ms).toISOString()}>{children}</time>
  );
}
