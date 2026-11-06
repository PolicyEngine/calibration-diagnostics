// The Staging page's `run` query parameter: the run a link opens.

export const STAGING_RUN_PARAM = "run";

// The run a Staging page URL names, or "" when it names none.
export function stagingRunFromSearch(_search: URLSearchParams): string {
  return "";
}

// `currentUrl` with `runId` as the page's run, keeping every other parameter.
export function withStagingRun(currentUrl: string, _runId: string): string {
  return currentUrl;
}
