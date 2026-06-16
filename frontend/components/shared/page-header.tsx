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
  return (
    <header className="flex flex-col gap-3 pb-1">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
          {description && (
            <Text c="dimmed" size="sm" className="mt-2 max-w-3xl">
              {description}
            </Text>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
