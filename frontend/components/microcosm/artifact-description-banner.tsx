import { StatusPill } from "@/components/shared/status-pill";

// Provenance banner: renders the release's own description verbatim whenever
// the artifact carries one (Belgium states its US-survey donor support pool
// and Chronicle-fact target rule here). Releases without a description render
// nothing.
export function ArtifactDescriptionBanner({
  description,
}: {
  description?: string | null;
}) {
  if (!description?.trim()) return null;

  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--warn)] bg-card px-4 py-3 shadow-[var(--elev-1)]"
    >
      <StatusPill tone="warning">Provenance</StatusPill>
      <p className="text-sm font-medium text-foreground">{description}</p>
    </div>
  );
}
