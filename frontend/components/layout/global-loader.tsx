"use client";

import { useIsFetching } from "@tanstack/react-query";

/**
 * Thin animated bar at the very top of the page that's visible whenever any
 * React Query request is in flight. Gives the user a constant signal of
 * "something is loading" vs. "broken / nothing happening."
 */
export function GlobalLoader() {
  const fetching = useIsFetching();
  if (!fetching) return null;
  return (
    <div
      aria-label="Loading"
      role="progressbar"
      className="fixed top-0 left-0 right-0 z-50 h-0.5 overflow-hidden bg-transparent pointer-events-none"
    >
      <div className="h-full w-1/3 bg-primary animate-loading-bar" />
    </div>
  );
}
