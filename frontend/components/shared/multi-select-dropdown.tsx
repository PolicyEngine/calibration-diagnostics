"use client";

import { useEffect, useRef, useState } from "react";

export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
}

interface Props {
  label: string;                    // e.g. "Geo"
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear?: () => void;
  className?: string;
  disabled?: boolean;
}

/**
 * Lightweight checkbox-popover dropdown. Click trigger to open; click outside
 * or press Esc to close. The trigger label is "<label>: <summary>".
 */
export function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
  className = "",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    selected.length === 0
      ? "Any"
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  const active = selected.length > 0;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm transition-colors min-w-[160px] justify-between disabled:opacity-50 disabled:cursor-not-allowed ${
          active
            ? "border-primary bg-primary/5 text-foreground"
            : "border-border bg-background text-foreground hover:bg-muted/40"
        }`}
      >
        <span className="flex items-baseline gap-1.5 truncate">
          <span className="text-xs font-medium text-muted-foreground">
            {label}:
          </span>
          <span className="truncate font-medium">{summary}</span>
        </span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          className={`shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-50 min-w-[220px] rounded-md border border-border bg-popover shadow-lg">
          <ul className="max-h-72 overflow-y-auto p-1 text-sm">
            {options.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <li key={opt.value}>
                  <label
                    className={`flex items-center justify-between gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-muted ${
                      checked ? "bg-muted/40" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(opt.value)}
                        className="shrink-0"
                      />
                      <span className="truncate">{opt.label}</span>
                    </span>
                    {opt.count !== undefined && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {opt.count}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          {onClear && selected.length > 0 && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={onClear}
                className="w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground text-left"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
