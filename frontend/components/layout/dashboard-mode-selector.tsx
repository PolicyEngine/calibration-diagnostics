"use client";

import { useDashboardMode, type DashboardMode } from "@/lib/dashboard-mode-context";

const OPTIONS: { id: DashboardMode; label: string; hint: string }[] = [
  {
    id: "microplex",
    label: "Microplex",
    hint: "Synthetic pipeline and parity artifacts",
  },
  {
    id: "populace",
    label: "Populace",
    hint: "Published populace-US releases",
  },
  {
    id: "us-data",
    label: "us-data",
    hint: "Current calibration diagnostics",
  },
  {
    id: "comparison",
    label: "Comparison",
    hint: "Side-by-side summary",
  },
];

export function DashboardModeSelector() {
  const { mode, setMode } = useDashboardMode();
  const active = OPTIONS.find((option) => option.id === mode);

  return (
    <div className="px-3 pb-3">
      <label
        htmlFor="dashboard-mode"
        className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground"
      >
        View
      </label>
      <select
        id="dashboard-mode"
        value={mode}
        onChange={(event) => setMode(event.target.value as DashboardMode)}
        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
      >
        {OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {active && (
        <p className="mt-1 text-xs text-muted-foreground">{active.hint}</p>
      )}
    </div>
  );
}

