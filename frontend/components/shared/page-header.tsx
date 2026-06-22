"use client";

import type { ReactNode } from "react";
import { Text, Title } from "@policyengine/ui-kit";

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
}: PageHeaderProps) {
  // The title row + actions (e.g. the release selector) are rendered as a
  // sibling of the description rather than wrapped in a short <header>, so the
  // sticky bar's containing block is the tall page content and it stays pinned
  // to the top through the whole scroll.
  return (
    <>
      <div className="sticky top-0 z-20 -mx-6 flex flex-wrap items-start justify-between gap-4 border-b border-border bg-background/85 px-6 pb-3 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Title order={2}>{title}</Title>
            {status}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && (
        <Text c="dimmed" size="sm" className="-mt-1 max-w-3xl">
          {description}
        </Text>
      )}
    </>
  );
}
