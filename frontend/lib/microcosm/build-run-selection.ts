import type { BuildTimeline } from "@/lib/microcosm/build-monitor";

// The run the build monitor shows once its list has loaded: the selected run
// while the list holds it, or when a link named it (a run older than the list
// is read on its own, and one that does not exist is reported as not found);
// otherwise the preferred run if the list holds it, else a running run, else
// the newest run that ended with a final event, else the newest run.
export function nextBuildRunSelection(
  runs: readonly BuildTimeline[],
  selected: string,
  preferredRunId: string | undefined,
): string {
  if (!runs.length) return selected;
  if (runs.some((run) => run.run_id === selected)) return selected;
  if (selected && selected === preferredRunId) return selected;
  const preferred = runs.find((run) => run.run_id === preferredRunId);
  const running = runs.find((run) => run.state === "running");
  const ended = runs.find((run) => run.state !== "stalled");
  return (preferred ?? running ?? ended ?? runs[0]).run_id;
}

// The run the Candidate tab shows, whenever its list or the page's run
// changes: the run the page's URL names when it is a staging candidate; else
// the run shown, while the list still holds it and the page's run has not
// just changed (a list refresh); else the newest. `missing` says that the URL
// names a run the list does not hold, and the tab says so.
export function candidateRunSelection(
  runIds: readonly string[],
  selected: string,
  preferredRunId: string | undefined,
  pageRunChanged = false,
): { runId: string | null; missing: boolean } {
  const missing = Boolean(preferredRunId) && !runIds.includes(preferredRunId!);
  if (preferredRunId && !missing) return { runId: preferredRunId, missing };
  if (!pageRunChanged && selected && runIds.includes(selected)) return { runId: selected, missing };
  return { runId: runIds[0] ?? null, missing };
}

// Whether the build monitor waits for its run list instead of showing a run:
// while the list loads with no runs yet, unless a run is selected and its
// detail has arrived.
export function waitsForRunList(
  listLoading: boolean,
  runCount: number,
  selected: string,
  hasDetail: boolean,
): boolean {
  return listLoading && runCount === 0 && !(selected && hasDetail);
}
