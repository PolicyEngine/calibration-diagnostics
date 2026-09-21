// Older dashboard links used `staging:<run_id>` on published-release pages.
// Those pages now discard the obsolete selector; staging candidates are
// reviewed only on the Staging candidates page.
export const STAGING_SELECTION_PREFIX = "staging:";

export function isStagingSelection(selection: string | null | undefined): boolean {
  return typeof selection === "string" && selection.startsWith(STAGING_SELECTION_PREFIX);
}

/** Keep published-release selectors off pages that do not review staging runs. */
export function publishedReleaseSelection(
  selection: string | null | undefined,
): string {
  return isStagingSelection(selection) ? "" : (selection ?? "");
}
