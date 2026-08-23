import { StatusPill } from "@/components/shared/status-pill";

export function ArtifactDescriptionBanner({
  description,
}: {
  description?: string | null;
}) {
  if (!description?.includes("DEMO-GRADE:")) return null;

  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--warn)] bg-card px-4 py-3 shadow-[var(--elev-1)]"
    >
      <StatusPill tone="warning">Demo grade</StatusPill>
      <p className="text-sm font-medium text-foreground">{description}</p>
    </div>
  );
}
