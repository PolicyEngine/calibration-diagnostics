import type { BuildRunSource } from "@/lib/microcosm/build-monitor";

// Which build lists the build monitor requests. Local runs need a folder the
// server names in MICROCOSM_LOCAL_RUNS_DIR. The page knows whether it had one
// when it was prerendered; the hosted list's answer says whether the server
// that answers has one.

// Whether to request the local list: when the page knew of a folder, when the
// hosted list's answer reports one, or when the hosted list failed and so
// could not say (the local list then answers whether there is one).
export function localListRequested(
  localRunsEnabled: boolean,
  hostedListReportsLocalRuns: boolean,
  hostedListFailed: boolean,
): boolean {
  return localRunsEnabled || hostedListReportsLocalRuns || hostedListFailed;
}

// Whether to request the hosted list now: at once without a local runs
// folder, as on the hosted dashboard; with one, once the local list, which
// says whether this machine's runs are opened instead, has answered.
export function hostedListRequested(
  localRunsEnabled: boolean,
  source: BuildRunSource,
  localListLoading: boolean,
): boolean {
  return source === "staging" && (!localRunsEnabled || !localListLoading);
}

// Whether the build monitor opens this machine's runs by itself: when the
// page knew of a local runs folder, so the local list answered before the
// hosted list was requested, and the local runs hold the run carried over
// from the Candidate tab, if any. A folder found only through the hosted
// list's answer comes after the hosted runs are on screen; the source switch
// offers its runs instead of replacing what is shown.
export function opensLocalRuns(
  localRunsEnabled: boolean,
  localListReportsLocalRuns: boolean,
  localRunIds: readonly string[],
  preferredRunId: string | undefined,
): boolean {
  return (
    localRunsEnabled &&
    localListReportsLocalRuns &&
    (!preferredRunId || localRunIds.includes(preferredRunId))
  );
}
