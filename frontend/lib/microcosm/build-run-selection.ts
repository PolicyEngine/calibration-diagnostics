import type { BuildTimeline } from "@/lib/microcosm/build-monitor";

// The run the build monitor shows once its list has loaded: the selected run
// while the list holds it, or when a link named it (a run older than the list
// is read on its own); otherwise the preferred run if the list holds it, else
// a running run, else the newest run that ended with a final event, else the
// newest run.
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

// The run the build monitor shows once its list has loaded, and the run to
// write into the page's URL (null leaves the URL as it is), so the URL always
// names the run shown: the run the tab opens by default is written there. A
// selected run that no source holds (`selectedNotFound`), such as one a link
// names that does not exist, gives way to the default run, in the URL too;
// when the list holds no other run it stays, and the tab shows its error.
// Only a run this rule switches to is written: choosing a run writes it at
// once, and after Back or Forward changes the URL's run, the selected run is
// the old one for a render, so writing it back would undo the navigation.
// While a selected run and the URL's run differ, nothing changes: either the
// URL changed and the view copies its run next, or a choice is on its way
// into the URL.
export function buildRunToShow(
  runs: readonly BuildTimeline[],
  selected: string,
  preferredRunId: string | undefined,
  selectedNotFound: boolean,
): { runId: string; urlRunId: string | null } {
  if (!runs.length) return { runId: selected, urlRunId: null };
  if (selected && preferredRunId && selected !== preferredRunId) return { runId: selected, urlRunId: null };
  if (selectedNotFound && selected) {
    const others = runs.filter((run) => run.run_id !== selected);
    if (!others.length) return { runId: selected, urlRunId: null };
    const runId = nextBuildRunSelection(others, "", undefined);
    return { runId, urlRunId: runId };
  }
  const runId = nextBuildRunSelection(runs, selected, preferredRunId);
  return { runId, urlRunId: runId && runId !== selected && runId !== preferredRunId ? runId : null };
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

// Whether the run detail on screen is the previous run's, kept while the
// selected run is asked for, after the selected run has already failed.
export function placeholderHidesFailure(isPlaceholderData: boolean, errorUpdateCount: number): boolean {
  return isPlaceholderData && errorUpdateCount > 0;
}

// Whether the build monitor shows the selected run as loading: its detail is
// being asked for and there is no detail to draw. A retry whose placeholder
// is hidden (see placeholderHidesFailure) counts: TanStack Query reports
// placeholder data as loaded, not loading.
export function runDetailLoading(
  detail: { isLoading: boolean; isFetching: boolean },
  hasDetailToDraw: boolean,
): boolean {
  return (detail.isLoading || detail.isFetching) && !hasDetailToDraw;
}
