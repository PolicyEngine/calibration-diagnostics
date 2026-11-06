import type { BuildRunSource } from "@/lib/microcosm/build-monitor";

// Which build lists the build monitor requests. Local runs need a folder the
// server names in MICROCOSM_LOCAL_RUNS_DIR. The page knows whether it had one
// when it was prerendered; the hosted list's answer says whether the server
// that answers has one.

// Whether to request the local list.
export function localListRequested(
  localRunsEnabled: boolean,
  hostedListReportsLocalRuns: boolean,
): boolean {
  return localRunsEnabled || hostedListReportsLocalRuns;
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

// Whether the build monitor opens this machine's runs by itself. As before,
// only when local runs exist and hold the run carried over from the
// Candidate tab, if any.
export function opensLocalRuns(
  _localRunsEnabled: boolean,
  localListReportsLocalRuns: boolean,
  localRunIds: readonly string[],
  preferredRunId: string | undefined,
): boolean {
  return (
    localListReportsLocalRuns && (!preferredRunId || localRunIds.includes(preferredRunId))
  );
}
