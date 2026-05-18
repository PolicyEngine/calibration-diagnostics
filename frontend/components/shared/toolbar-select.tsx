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
}

/**
 * Single-select native dropdown styled to match MultiSelectDropdown. Renders
 * "<label>: <selected option>" with a custom chevron.
 */
export function ToolbarSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  className = "",
}: Props) {
  const id = useId();
  const active = !!value && value !== "";
  return (
    <div
      className={`relative inline-flex items-center ${
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
        className={`appearance-none h-10 rounded-md border px-3 pr-8 text-sm font-medium transition-colors min-w-[160px] cursor-pointer disabled:cursor-not-allowed ${
          active
            ? "border-primary bg-primary/5"
            : "border-border bg-background hover:bg-muted/40"
        }`}
        style={{ paddingLeft: `${label.length * 7 + 16}px` }}
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
