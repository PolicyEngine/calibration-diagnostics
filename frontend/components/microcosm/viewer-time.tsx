"use client";

import type { ReactNode } from "react";

import { browserZone, type ViewerZone } from "@/lib/microcosm/viewer-time";

// The zone the page's times are shown in.
export function useViewerZone(): ViewerZone | null {
  return browserZone();
}

// A displayed time.
export function ViewerTime({
  children,
}: {
  ms: number;
  zone: ViewerZone | null;
  children: ReactNode;
}) {
  return <>{children}</>;
}
