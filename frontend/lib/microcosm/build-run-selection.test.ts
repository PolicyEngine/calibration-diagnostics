import { expect, test } from "bun:test";

import type { BuildRunState, BuildTimeline } from "@/lib/microcosm/build-monitor";
import { candidateRunSelection, nextBuildRunSelection, waitsForRunList } from "@/lib/microcosm/build-run-selection";

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
  expect(candidateRunSelection(["newest", "linked"], "", "linked")).toEqual({ runId: "linked", missing: false });
  expect(candidateRunSelection(["newest", "other"], "", "linked")).toEqual({ runId: "newest", missing: true });
  expect(candidateRunSelection(["newest"], "", undefined)).toEqual({ runId: "newest", missing: false });
  expect(candidateRunSelection([], "", "linked")).toEqual({ runId: null, missing: true });
});

test("after the Candidate list refreshes, the run shown and the notice still agree with the link", () => {
  // No link: a new candidate does not take the place of the run shown.
  expect(candidateRunSelection(["brand-new", "shown"], "shown", undefined)).toEqual({
    runId: "shown",
    missing: false,
  });
  // A linked run that has become a candidate opens.
  expect(candidateRunSelection(["new", "linked", "shown"], "shown", "linked")).toEqual({
    runId: "linked",
    missing: false,
  });
  // A linked run that is still not a candidate leaves the run shown as it is.
  expect(candidateRunSelection(["brand-new", "shown"], "shown", "linked")).toEqual({
    runId: "shown",
    missing: true,
  });
  // A linked run on screen that leaves the list gives way to the newest.
  expect(candidateRunSelection(["newest"], "linked", "linked")).toEqual({ runId: "newest", missing: true });
});

test("when the page's run changes, the Candidate tab drops the run it was showing", () => {
  // The sidebar link removes the run from the URL: back to the newest.
  expect(candidateRunSelection(["newest", "linked"], "linked", undefined, true)).toEqual({
    runId: "newest",
    missing: false,
  });
  // A refresh with the URL's run unchanged keeps the run shown.
  expect(candidateRunSelection(["newest", "shown"], "shown", undefined, false)).toEqual({
    runId: "shown",
    missing: false,
  });
});

test("the build monitor shows a run before its list only when that run is selected", () => {
  // A linked run's detail arrived first: show it.
  expect(waitsForRunList(true, 0, "linked-run", true)).toBe(false);
  // After switching source nothing is selected; the previous source's run
  // detail, kept while the next loads, is not shown.
  expect(waitsForRunList(true, 0, "", true)).toBe(true);
  expect(waitsForRunList(true, 0, "", false)).toBe(true);
  expect(waitsForRunList(false, 0, "", false)).toBe(false);
});
