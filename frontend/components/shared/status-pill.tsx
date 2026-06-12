"use client";

import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

interface StatusPillProps {
  children: ReactNode;
  tone?: StatusTone;
  icon?: ReactNode;
}

const toneClasses: Record<StatusTone, string> = {
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-rose-50 text-rose-800 border-rose-200",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  neutral: "bg-muted/60 text-muted-foreground border-border",
};

const dotClasses: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-sky-500",
  neutral: "bg-muted-foreground/60",
};

export function StatusPill({ children, tone = "neutral", icon }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none ${toneClasses[tone]}`}
    >
      {icon ?? <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />}
      {children}
    </span>
  );
}
