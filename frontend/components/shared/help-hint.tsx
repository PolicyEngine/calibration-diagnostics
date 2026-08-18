"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

interface HelpHintProps {
  label: ReactNode;
  tooltip: string;
  interaction?: "hover" | "click";
  underline?: boolean;
  inheritTypography?: boolean;
}

export function HelpHint({
  label,
  tooltip,
  interaction = "hover",
  underline = true,
  inheritTypography = false,
}: HelpHintProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (interaction !== "click" || !open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [interaction, open]);

  const typography = inheritTypography ? "" : "normal-case tracking-normal";
  const labelClass = underline ? "underline decoration-dotted underline-offset-2" : "";

  if (interaction === "click") {
    return (
      <span ref={rootRef} className={`relative inline-flex ${typography}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={tooltipId}
          onClick={() => setOpen((current) => !current)}
          className={`inline-flex cursor-pointer items-center gap-1 text-inherit ${
            inheritTypography ? "uppercase" : ""
          }`}
        >
          <span className={labelClass}>{label}</span>
          <span
            aria-hidden
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card text-[10px] font-normal leading-none text-muted-foreground"
          >
            ?
          </span>
        </button>
        {open && (
          <span
            id={tooltipId}
            role="tooltip"
            className="absolute left-0 top-full z-50 mt-2 w-72 rounded-md border border-border bg-card p-3 text-left text-xs font-normal normal-case leading-snug tracking-normal text-foreground shadow-lg"
          >
            {tooltip}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      className={`group relative inline-flex cursor-help items-center gap-1 ${typography}`}
      tabIndex={0}
    >
      <span className={labelClass}>{label}</span>
      <span
        aria-hidden
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card text-[10px] font-normal leading-none text-muted-foreground"
      >
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 rounded-md border border-border bg-card p-3 text-left text-xs font-normal leading-snug text-foreground shadow-lg group-hover:block group-focus:block"
      >
        {tooltip}
      </span>
    </span>
  );
}
