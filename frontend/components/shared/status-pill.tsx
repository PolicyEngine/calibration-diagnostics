"use client";

import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

interface StatusPillProps {
  children: ReactNode;
  tone?: StatusTone;
  icon?: ReactNode;
}

const toneClasses: Record<StatusTone, string> = {
  success: "pill-pos",
  warning: "pill-warn",
  danger: "pill-neg",
  info: "pill-info",
  neutral: "pill-neutral",
};

const dotClasses: Record<StatusTone, string> = {
  success: "swatch-pos",
  warning: "swatch-warn",
  danger: "swatch-neg",
  info: "swatch-info",
  neutral: "swatch-neutral",
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
