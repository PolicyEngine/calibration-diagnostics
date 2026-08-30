"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@policyengine/ui-kit";
import type { ReactNode } from "react";

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
  const typography = inheritTypography ? "" : "normal-case tracking-normal";
  const labelClass = underline ? "underline decoration-dotted underline-offset-2" : "";
  const triggerClassName = `inline-flex cursor-pointer items-center gap-1 text-inherit ${typography} ${
    inheritTypography ? "uppercase" : ""
  }`;
  const trigger = (
    <button type="button" className={triggerClassName}>
      <span className={labelClass}>{label}</span>
      <span
        aria-hidden
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card text-[10px] font-normal leading-none text-muted-foreground"
      >
        ?
      </span>
    </button>
  );
  const overlayClassName =
    "z-[100] max-h-[var(--radix-popper-available-height)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto border-border bg-popover p-3 text-left text-xs font-normal normal-case leading-snug tracking-normal text-popover-foreground shadow-lg";

  if (interaction === "click") {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className={overlayClassName}
        >
          {tooltip}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={8}
          collisionPadding={12}
          className={overlayClassName}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
