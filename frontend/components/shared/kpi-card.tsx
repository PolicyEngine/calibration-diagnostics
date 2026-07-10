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
  positive: "pill-pos",
  negative: "pill-neg",
  neutral: "pill-neutral",
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
    <div className="flex h-full flex-col justify-between gap-2 rounded-lg border border-border bg-card p-4 shadow-[var(--elev-1)]">
      <div className="flex items-start justify-between gap-2">
        <Text size="xs" c="dimmed" className="font-mono font-medium uppercase tracking-wide">
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
