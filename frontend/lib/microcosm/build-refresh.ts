import type { BuildRunSource, BuildRunState } from "@/lib/microcosm/build-monitor";

// How often the build monitor asks again for the selected run; false never.
export function buildRunRefetchInterval(
  source: BuildRunSource,
  _runState: BuildRunState | undefined,
): number | false {
  return source === "local" ? 10 * 1000 : 30 * 1000;
}

// How often the build monitor asks again for its run list.
export function buildListRefetchInterval(source: BuildRunSource): number {
  return source === "local" ? 10 * 1000 : 30 * 1000;
}
