import type { BuildRunSource, BuildRunState } from "@/lib/microcosm/build-monitor";

// How often the build monitor asks again for the selected run: only while it
// is running, every minute (every 10 seconds for a local run folder, which
// is free to read); a run that ended, failed or went silent never changes
// on its own, so it is not asked for again.
export function buildRunRefetchInterval(
  source: BuildRunSource,
  runState: BuildRunState | undefined,
): number | false {
  if (runState !== "running") return false;
  return source === "local" ? 10 * 1000 : 60 * 1000;
}

// How often the build monitor asks again for its run list, which is how a new
// run appears: every five minutes (every 10 seconds for local run folders).
export function buildListRefetchInterval(source: BuildRunSource): number {
  return source === "local" ? 10 * 1000 : 5 * 60 * 1000;
}
