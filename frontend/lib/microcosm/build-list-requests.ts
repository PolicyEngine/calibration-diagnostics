import type { BuildRunSource } from "@/lib/microcosm/build-monitor";

// Which build lists the build monitor requests. Local runs need a folder the
// server names in MICROCOSM_LOCAL_RUNS_DIR. The page knows whether it had one
// when it was prerendered; the hosted list's answer says whether the server
// that answers has one.

// Whether to request the local list.
export function localListRequested(
  localRunsEnabled: boolean,
  _hostedListReportsLocalRuns: boolean,
): boolean {
  return localRunsEnabled;
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
