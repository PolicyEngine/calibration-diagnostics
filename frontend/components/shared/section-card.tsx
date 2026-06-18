"use client";

import type { ReactNode } from "react";
import { Card, CardContent, Text } from "@policyengine/ui-kit";

interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}

export function SectionCard({
  title,
  description,
  actions,
  footer,
  padded = true,
  className,
  children,
}: SectionCardProps) {
  return (
    <Card
      className={`overflow-visible border-border/80 shadow-[0_1px_0_rgba(15,23,42,0.04)] ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3">
        <div className="min-w-[220px] flex-1">
          <div className="text-sm font-semibold leading-tight text-foreground">
            {title}
          </div>
          {description && (
            <Text size="xs" c="dimmed" className="mt-1 max-w-2xl leading-snug">
              {description}
            </Text>
          )}
        </div>
        {actions && (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
      <CardContent className={padded ? "p-5" : "p-0"}>{children}</CardContent>
      {footer && (
        <div className="border-t border-border bg-muted/10 px-5 py-2 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </Card>
  );
}
