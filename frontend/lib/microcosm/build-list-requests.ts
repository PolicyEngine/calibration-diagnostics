import type { BuildRunSource } from "@/lib/microcosm/build-monitor";

export interface BuildListRequests {
  local: boolean;
  staging: boolean;
}

// Which build lists the build monitor requests now. Local runs need a folder
// the server names in MICROCOSM_LOCAL_RUNS_DIR. Without one, as on the hosted
// dashboard, the hosted list is requested at once and the local list not at
// all. With one, the hosted list waits for the local list, which says whether
// this machine's runs are opened instead.
export function buildListRequests(
  localRunsEnabled: boolean,
  source: BuildRunSource,
  localListLoading: boolean,
): BuildListRequests {
  return {
    local: localRunsEnabled,
    staging: source === "staging" && (!localRunsEnabled || !localListLoading),
  };
}
