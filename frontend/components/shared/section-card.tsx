"use client";

import type { ReactNode } from "react";
import { Card, CardContent, Text } from "@policyengine/ui-kit";

interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  // Overrides the description's reading width (max-w-2xl), for cards whose
  // description reads better across the full card.
  descriptionClassName?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
  headerAlign?: "start" | "center";
  className?: string;
  children: ReactNode;
}

export function SectionCard({
  title,
  description,
  descriptionClassName = "max-w-2xl",
  actions,
  footer,
  padded = true,
  headerAlign = "start",
  className,
  children,
}: SectionCardProps) {
  return (
    <Card
      className={`gap-0 overflow-visible border-border/80 py-0 shadow-[var(--elev-1)] ${className ?? ""}`}
    >
      <div
        className={`flex flex-wrap justify-between gap-3 border-b border-border bg-muted/20 px-5 py-3 ${
          headerAlign === "center" ? "items-center" : "items-start"
        }`}
      >
        <div className="min-w-[220px] flex-1">
          <div className="text-sm font-semibold leading-tight text-foreground">
            {title}
          </div>
          {description && (
            <Text size="xs" c="dimmed" className={`mt-1 leading-snug ${descriptionClassName}`}>
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
