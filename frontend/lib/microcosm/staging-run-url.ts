// The Staging page's `run` query parameter: the run a link opens, on either
// tab. Choosing a run writes it, so the page's URL always names the run shown
// once someone picks one.

export const STAGING_RUN_PARAM = "run";

// The run a Staging page URL names, or "" when it names none.
export function stagingRunFromSearch(search: URLSearchParams): string {
  return search.get(STAGING_RUN_PARAM)?.trim() ?? "";
}

// The run a Staging page URL names for `country`.
export function stagingRunForCountry(search: URLSearchParams, _country: string): string {
  return stagingRunFromSearch(search);
}

// `currentUrl` with `runId` as the page's run, keeping every other parameter;
// an empty `runId` removes the parameter.
export function withStagingRun(currentUrl: string, runId: string, _country: string): string {
  const url = new URL(currentUrl);
  if (runId) url.searchParams.set(STAGING_RUN_PARAM, runId);
  else url.searchParams.delete(STAGING_RUN_PARAM);
  return url.toString();
}
