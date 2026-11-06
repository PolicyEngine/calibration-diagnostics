import type { BuildRunSource } from "@/lib/microcosm/build-monitor";

export interface BuildListRequests {
  local: boolean;
  staging: boolean;
}

// Which build lists the build monitor requests now, as it does today: the
// local list always, and the hosted list once the local list has answered.
export function buildListRequests(
  _localRunsEnabled: boolean,
  source: BuildRunSource,
  localListLoading: boolean,
): BuildListRequests {
  return { local: true, staging: source === "staging" && !localListLoading };
}
