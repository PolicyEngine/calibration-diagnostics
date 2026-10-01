"use client";

export type StagingTab = "candidate" | "progress";

const TABS: { id: StagingTab; label: string; hint: string }[] = [
  {
    id: "candidate",
    label: "Candidate",
    hint: "Calibration fit and validation of the candidate dataset",
  },
  {
    id: "progress",
    label: "Build progress",
    hint: "Stage timeline, expected finish, failures, and where build time goes",
  },
];

export function parseStagingTab(value: string | null | undefined): StagingTab {
  return value === "progress" ? "progress" : "candidate";
}

// The two views of a staging run, switched in place. The choice is kept in
// the `view` query parameter so a link opens the same tab.
export function StagingPageTabs({
  value,
  onChange,
}: {
  value: StagingTab;
  onChange: (tab: StagingTab) => void;
}) {
  return (
    <div role="tablist" aria-label="Staging view" className="inline-flex rounded-md border border-border p-0.5">
      {TABS.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={tab.label}
            title={tab.hint}
            onClick={() => onChange(tab.id)}
            className={`h-8 rounded px-3 text-sm font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
