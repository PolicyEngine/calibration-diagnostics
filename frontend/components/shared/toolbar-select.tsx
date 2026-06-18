"use client";

import { useId } from "react";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  layout?: "inline" | "stacked";
}

/**
 * Single-select native dropdown styled to match MultiSelectDropdown. Renders
 * a compact inline label by default, or a stacked label for dense filter grids
 * with long dimension names.
 */
export function ToolbarSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  className = "",
  layout = "inline",
}: Props) {
  const id = useId();
  const active = !!value && value !== "";
  const selectClassName = `h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border px-3 pr-8 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
    active
      ? "border-primary bg-primary/5"
      : "border-border bg-background hover:bg-muted/40"
  }`;

  if (layout === "stacked") {
    return (
      <div
        className={`relative flex min-w-[136px] max-w-full flex-col gap-1 ${
          disabled ? "opacity-50" : ""
        } ${className}`}
      >
        <label
          htmlFor={id}
          className="truncate text-xs font-medium text-muted-foreground"
          title={label}
        >
          {label}
        </label>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={selectClassName}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          className="absolute bottom-[15px] right-3 pointer-events-none text-muted-foreground"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className={`relative inline-flex min-w-[136px] max-w-full items-center ${
        disabled ? "opacity-50" : ""
      } ${className}`}
    >
      <label
        htmlFor={id}
        className={`absolute left-3 pointer-events-none text-xs font-medium text-muted-foreground`}
      >
        {label}:
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        // Hide the native chevron, leave room on the right for ours.
        className={selectClassName}
        style={{ paddingLeft: `${Math.min(label.length * 7 + 16, 112)}px` }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        width="10"
        height="6"
        viewBox="0 0 10 6"
        fill="none"
        className="absolute right-3 pointer-events-none text-muted-foreground"
      >
        <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
