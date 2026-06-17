"use client";

import type { ReactNode } from "react";
import { Text } from "@policyengine/ui-kit";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  variant?: "default" | "compact";
}

export function EmptyState({
  title,
  description,
  actions,
  icon,
  variant = "default",
}: EmptyStateProps) {
  const padding = variant === "compact" ? "px-4 py-6" : "px-6 py-10";
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 text-center ${padding}`}
    >
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && (
        <Text size="xs" c="dimmed" className="max-w-md leading-snug">
          {description}
        </Text>
      )}
      {actions && <div className="mt-2 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
