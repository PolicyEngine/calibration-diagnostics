// Provenance note: render the release's own description verbatim whenever the
// artifact carries one. Releases without a description render nothing.
export function ArtifactDescriptionBanner({
  description,
}: {
  description?: string | null;
}) {
  if (!description?.trim()) return null;

  return (
    <div
      role="note"
      className="rounded-lg border border-border/80 bg-card px-4 py-3 shadow-[var(--elev-1)]"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Provenance
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
