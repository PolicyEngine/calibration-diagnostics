import { expect, test } from "bun:test";

import type { BuildRunState, BuildTimeline } from "@/lib/microcosm/build-monitor";
import {
  buildRunToShow,
  candidateRunSelection,
  nextBuildRunSelection,
  waitsForRunList,
} from "@/lib/microcosm/build-run-selection";

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

test("the run Build progress opens by default is written into the URL", () => {
  expect(buildRunToShow(RUNS, "", undefined, false)).toEqual({ runId: "running", urlRunId: "running" });
  expect(buildRunToShow([RUNS[0], RUNS[2]], "", undefined, false)).toEqual({ runId: "ended", urlRunId: "ended" });
});

test("a run the URL already names is shown, and the URL is left as it is", () => {
  expect(buildRunToShow(RUNS, "", "ended", false)).toEqual({ runId: "ended", urlRunId: null });
  expect(buildRunToShow(RUNS, "ended", "ended", false)).toEqual({ runId: "ended", urlRunId: null });
  // A run older than the list stays while its detail is read on its own.
  expect(buildRunToShow(RUNS, "older-run", "older-run", false)).toEqual({ runId: "older-run", urlRunId: null });
});

// Choosing a run writes it into the URL at once, so the URL is never written
// with the run already selected: after Back or Forward changes the URL's run,
// the selected run is the old one for a render, and writing it back would
// undo the browser's navigation.
test("the run already selected is never written back into the URL", () => {
  expect(buildRunToShow(RUNS, "ended", "running", false)).toEqual({ runId: "ended", urlRunId: null });
  expect(buildRunToShow(RUNS, "ended", undefined, false)).toEqual({ runId: "ended", urlRunId: null });
});

test("after Back or Forward between two runs outside the list, the run the URL names is kept", () => {
  // For a render the selected run is the previous entry's; the copy from the
  // URL then selects the new one, and nothing replaces it with the default.
  expect(buildRunToShow(RUNS, "older-a", "older-b", false)).toEqual({ runId: "older-a", urlRunId: null });
});

test("a run the URL names that no source holds gives way to the default run, in the URL too", () => {
  expect(buildRunToShow(RUNS, "not-a-run", "not-a-run", true)).toEqual({ runId: "running", urlRunId: "running" });
  // The default never falls back to the run that was not found.
  expect(buildRunToShow([run("not-a-run", "passed"), RUNS[2]], "not-a-run", "not-a-run", true)).toEqual({
    runId: "ended",
    urlRunId: "ended",
  });
});

test("a run that is not found stays, and its error shows, when the list holds no other run", () => {
  expect(buildRunToShow([run("not-a-run", "passed")], "not-a-run", "not-a-run", true)).toEqual({
    runId: "not-a-run",
    urlRunId: null,
  });
});

test("nothing changes before the run list has loaded", () => {
  expect(buildRunToShow([], "", undefined, false)).toEqual({ runId: "", urlRunId: null });
  expect(buildRunToShow([], "not-a-run", "not-a-run", true)).toEqual({ runId: "not-a-run", urlRunId: null });
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
