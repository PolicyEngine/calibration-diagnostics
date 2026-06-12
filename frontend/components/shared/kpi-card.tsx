"use client";

import type { ReactNode } from "react";
import { Text } from "@policyengine/ui-kit";

export type Tone = "positive" | "negative" | "neutral";

interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const toneClasses: Record<Tone, string> = {
  positive: "text-emerald-700 bg-emerald-50 border-emerald-200",
  negative: "text-rose-700 bg-rose-50 border-rose-200",
  neutral: "text-muted-foreground bg-muted/50 border-border",
};

export function KpiCard({
  label,
  value,
  delta,
  tone = "neutral",
  hint,
  size = "md",
}: KpiCardProps) {
  const valueSize =
    size === "lg"
      ? "text-3xl"
      : size === "sm"
        ? "text-lg"
        : "text-2xl";

  return (
    <div className="flex h-full flex-col justify-between gap-2 rounded-lg border border-border bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <Text size="xs" c="dimmed" className="font-medium uppercase tracking-wide">
          {label}
        </Text>
        {delta != null && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClasses[tone]}`}
          >
            {delta}
          </span>
        )}
      </div>
      <div className={`font-semibold leading-tight tabular-nums ${valueSize}`}>
        {value}
      </div>
      {hint && (
        <Text size="xs" c="dimmed" className="leading-snug">
          {hint}
        </Text>
      )}
    </div>
  );
}
