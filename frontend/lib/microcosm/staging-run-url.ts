// The Staging page's `run` query parameter: the run a link opens, on either
// tab. Choosing a run writes it, with the country, so a link opens the run
// chosen; a page that picks its own default run writes nothing.

export const STAGING_RUN_PARAM = "run";

// The run a Staging page URL names, or "" when it names none.
export function stagingRunFromSearch(search: URLSearchParams): string {
  return search.get(STAGING_RUN_PARAM)?.trim() ?? "";
}

// The run a Staging page URL names for `country`: none when the URL names
// another country. Switching country remounts the page while the URL still
// holds the previous country's run.
export function stagingRunForCountry(search: URLSearchParams, country: string): string {
  const urlCountry = search.get("country");
  if (urlCountry != null && urlCountry !== country) return "";
  return stagingRunFromSearch(search);
}

// `currentUrl` with `runId` as the page's run, keeping every other parameter;
// an empty `runId` removes the parameter. A run belongs to one country's
// builds, so the page's country is written with it.
export function withStagingRun(currentUrl: string, runId: string, country: string): string {
  const url = new URL(currentUrl);
  if (runId) {
    url.searchParams.set("country", country);
    url.searchParams.set(STAGING_RUN_PARAM, runId);
  } else {
    url.searchParams.delete(STAGING_RUN_PARAM);
  }
  return url.toString();
}
