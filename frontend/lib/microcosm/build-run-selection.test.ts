import { expect, test } from "bun:test";

import type { BuildRunState, BuildTimeline } from "@/lib/microcosm/build-monitor";
import { candidateRunSelection, nextBuildRunSelection } from "@/lib/microcosm/build-run-selection";

// Only the fields the selection reads.
function run(runId: string, state: BuildRunState): BuildTimeline {
  return { run_id: runId, state } as BuildTimeline;
}

const RUNS = [run("newest-stalled", "stalled"), run("running", "running"), run("ended", "passed")];

test("a run a link names stays selected when the list does not hold it", () => {
  // The run is older than the list's 60 runs, or not a run at all; the run
  // detail is read on its own and says which.
  expect(nextBuildRunSelection(RUNS, "older-run", "older-run")).toBe("older-run");
});

test("a run a link names is selected when the list holds it", () => {
  expect(nextBuildRunSelection(RUNS, "", "ended")).toBe("ended");
  expect(nextBuildRunSelection(RUNS, "ended", "ended")).toBe("ended");
});

test("without a named run a running run is selected, else the newest run that ended", () => {
  expect(nextBuildRunSelection(RUNS, "", undefined)).toBe("running");
  expect(nextBuildRunSelection([RUNS[0], RUNS[2]], "", undefined)).toBe("ended");
  // A run picked earlier that the list no longer holds, after switching
  // source, gives way to the default.
  expect(nextBuildRunSelection(RUNS, "gone", undefined)).toBe("running");
});

test("the Candidate tab opens a linked run it holds, and says when it holds none", () => {
  expect(candidateRunSelection(["newest", "linked"], "linked")).toEqual({ runId: "linked", missing: false });
  expect(candidateRunSelection(["newest", "other"], "linked")).toEqual({ runId: "newest", missing: true });
  expect(candidateRunSelection(["newest"], undefined)).toEqual({ runId: "newest", missing: false });
  expect(candidateRunSelection([], "linked")).toEqual({ runId: null, missing: true });
});
