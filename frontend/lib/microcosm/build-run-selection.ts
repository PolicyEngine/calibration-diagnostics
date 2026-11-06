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

// The run the Candidate tab opens: the preferred run when the list holds it,
// else the newest. `missing` says that a preferred run was not in the list.
export function candidateRunSelection(
  runIds: readonly string[],
  _selected: string,
  preferredRunId: string | undefined,
): { runId: string | null; missing: boolean } {
  const preferred = runIds.find((runId) => runId === preferredRunId);
  return {
    runId: preferred ?? runIds[0] ?? null,
    missing: Boolean(preferredRunId) && preferred == null,
  };
}
