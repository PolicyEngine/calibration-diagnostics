"use client";

import type { ReactNode } from "react";

interface HelpHintProps {
  label: ReactNode;
  tooltip: string;
}

export function HelpHint({ label, tooltip }: HelpHintProps) {
  return (
    <span
      className="group relative inline-flex cursor-help items-center gap-1 normal-case tracking-normal"
      tabIndex={0}
    >
      <span className="underline decoration-dotted underline-offset-2">{label}</span>
      <span
        aria-hidden
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-white text-[10px] font-normal leading-none text-muted-foreground"
      >
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 rounded-md border border-border bg-white p-3 text-left text-xs font-normal leading-snug text-foreground shadow-lg group-hover:block group-focus:block"
      >
        {tooltip}
      </span>
    </span>
  );
}
