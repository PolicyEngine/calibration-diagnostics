"use client";

import { Spinner } from "@policyengine/ui-kit";

/**
 * Centered spinner + label, used in place of a bare Skeleton when we want
 * the user to see explicit "this is loading" feedback rather than a static
 * grey block that's easy to misread as "broken."
 */
export function LoadingBlock({
  label = "Loading…",
  height = "h-64",
}: {
  label?: string;
  height?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 ${height} w-full rounded-lg border border-dashed border-border bg-muted/20`}
    >
      <Spinner size="md" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
