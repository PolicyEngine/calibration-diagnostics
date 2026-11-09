import type { BuildRunSource, BuildRunState } from "@/lib/microcosm/build-monitor";

// How often the build monitor asks again for the selected run: while it is
// running, or while asking for it fails, every minute (every 10 seconds for a
// local run folder, which is free to read). A run that ended, failed or went
// silent is not asked for again on a timer; one that comes back to life is
// caught by the run list (see `detailBehindList`).
export function buildRunRefetchInterval(
  source: BuildRunSource,
  runState: BuildRunState | undefined,
  detailFailed = false,
): number | false {
  if (runState !== "running" && !detailFailed) return false;
  return source === "local" ? 10 * 1000 : 60 * 1000;
}

// How often the build monitor asks again for its run list, which is how a new
// run appears: every five minutes (every 10 seconds for local run folders).
export function buildListRefetchInterval(source: BuildRunSource): number {
  return source === "local" ? 10 * 1000 : 5 * 60 * 1000;
}

// Whether the selected run's detail should be asked for again because the
// run list, asked for more recently, gives the run another state.
export function detailBehindList(
  listRunState: BuildRunState | undefined,
  detailRunState: BuildRunState | undefined,
): boolean {
  return listRunState != null && detailRunState != null && listRunState !== detailRunState;
}
