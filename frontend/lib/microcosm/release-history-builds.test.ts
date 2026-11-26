import { expect, test } from "bun:test";

import {
  buildFacts,
  buildMarks,
  buildStateLabel,
  buildsWithoutRun,
  compatibleModelsLabel,
  packageLabel,
  stepFacts,
  withoutRunCount,
} from "./release-history-builds";
import { dateShort } from "./release-history-format";
import type { TimelineBuild } from "./release-history-store";
import { smallTimeline } from "./test-support/release-history-small-timeline";
import { syntheticPanelView } from "./test-support/release-history-synthetic-view";

const dates = (builds: readonly TimelineBuild[]) => builds.map((build) => dateShort(build.publishedAt));

test("the time axis marks a new build engine, a republished file and a withdrawn build", async () => {
  const { timeline } = await syntheticPanelView("uk");
  const marks = buildMarks(timeline.builds);
  const marked = timeline.builds.flatMap((build, index) =>
    marks[index].length > 0 ? [[dateShort(build.publishedAt), ...marks[index]]] : []
  );
  expect(marked).toEqual([
    ["21 Oct", "same_file"],
    ["29 Oct", "withdrawn"],
    // The first build made with another model version than the build before it.
    ["2 Nov", "new_build_engine"],
  ]);

  // On the newer engine the withdrawn build holds no point, and the mark still falls on 2 Nov.
  const newer = await syntheticPanelView("uk", "newer");
  expect(buildMarks(newer.timeline.builds).map((list) => list.join("+"))).toEqual(marks.map((list) => list.join("+")));
});

test("a timeline written before it carried build facts has no build-engine mark and no facts", async () => {
  const { timeline } = await syntheticPanelView("uk");
  const earlier = timeline.builds.map(({ declared: _declared, ...build }) => build as TimelineBuild);
  expect(buildMarks(earlier).flat()).toEqual(["same_file", "withdrawn"]);
  expect(buildFacts(earlier[0])).toMatchObject({ declared: false, builtWithModel: null, codeCommit: null, commitUrl: null });
});

test("the builds an engine has no run for are named by why, and a withdrawn build is not among them", async () => {
  const served = buildsWithoutRun((await syntheticPanelView("uk")).timeline.builds);
  expect(served.onAxis).toBe(11);
  expect(dates(served.neverRun)).toEqual(["17 Nov", "24 Nov"]);
  expect(dates(served.refused)).toEqual(["24 Oct"]);
  expect([served.retrying, served.failed]).toEqual([[], []]);
  expect(withoutRunCount(served)).toBe(3);

  const pinned = buildsWithoutRun((await syntheticPanelView("uk", "newer")).timeline.builds);
  // The build withdrawn before the bump was never measured on the newer engine, by design.
  expect(pinned.neverRun).toEqual([]);
  expect(dates(pinned.failed)).toEqual(["5 Nov"]);
  expect(pinned.failed[0].reason).toBe("exceeds_runner_budget");
  expect(dates(pinned.retrying)).toEqual(["24 Nov"]);
  expect(dates(pinned.refused)).toEqual(["24 Oct"]);

  const complete = buildsWithoutRun((await syntheticPanelView("us")).timeline.builds);
  expect(withoutRunCount(complete)).toBe(0);
  const other = buildsWithoutRun((await syntheticPanelView("us", "other")).timeline.builds);
  expect(other.neverRun).toHaveLength(4);
});

test("a build's state reads in the page's words", () => {
  expect(buildStateLabel({ state: "measured", status: "ok" })).toBe("Measured");
  expect(buildStateLabel({ state: "measured", status: "partial" })).toBe("Partial");
  expect(buildStateLabel({ state: "gap", status: "refused" })).toBe("File refused");
  expect(buildStateLabel({ state: "retrying", status: null })).toBe("Retrying");
  expect(buildStateLabel({ state: "failed", status: null })).toBe("Out of attempts");
  expect(buildStateLabel({ state: "missing", status: null })).toBe("Not measured");
});

test("a step's card holds the facts of its two builds, and its neighbour is never a withdrawn build", async () => {
  const { timeline } = await syntheticPanelView("uk");
  const index = timeline.builds.findIndex((build) => dateShort(build.publishedAt) === "2 Nov");
  const step = stepFacts(timeline.builds, index)!;
  expect(timeline.builds[index - 1].withdrawn).toBe(true);
  expect(step.from!.build.buildId).toBe(timeline.builds[index - 2].buildId);
  expect(step.noStepReason).toBeNull();
  expect(step.to).toMatchObject({
    declared: true,
    fetchedThrough: null,
    builtWithModel: "policyengine-uk 0.10.0",
    builtWithCore: "policyengine-core 3.33.3",
    compatibleModels: "policyengine-uk ==0.10.0",
    codeRepository: "PolicyEngine/microcosm",
    nTargets: 1214,
    targetRegistryVersion: "2026.10",
    householdWeightYear: "2024",
  });
  expect(step.from).toMatchObject({ builtWithModel: "policyengine-uk 0.9.0", nTargets: 1200 });
  expect(step.to.commitUrl).toBe(`https://github.com/PolicyEngine/microcosm/commit/${step.to.codeCommit}`);
  expect(step.compareUrl).toBe(
    `https://github.com/PolicyEngine/microcosm/compare/${step.from!.codeCommit}...${step.to.codeCommit}`,
  );
  expect(step).toMatchObject({
    buildEngineChanged: true,
    targetSetChanged: true,
    targetRegistryChanged: false,
    columnsAdded: ["synthetic_new_column"],
    columnsRemoved: [],
  });
  // The next step keeps the engine and the target set.
  expect(stepFacts(timeline.builds, index + 1)).toMatchObject({
    buildEngineChanged: false,
    targetSetChanged: false,
    columnsAdded: [],
    compareUrl: expect.stringContaining("/compare/"),
  });
});

test("a build that cannot have a step says why", async () => {
  const { timeline } = await syntheticPanelView("uk");
  const reason = (date: string) =>
    stepFacts(timeline.builds, timeline.builds.findIndex((build) => dateShort(build.publishedAt) === date))!.noStepReason;
  expect(stepFacts(timeline.builds, 0)).toMatchObject({ from: null, noStepReason: "This is the first build of the series." });
  expect(reason("29 Oct")).toBe("This build was withdrawn, so no step starts or ends at it.");
  expect(reason("24 Oct")).toBe("This engine holds no value for this build.");
  expect(reason("27 Oct")).toBe("This engine holds no value for the build before it.");
  expect(reason("17 Nov")).toBe("This engine holds no value for this build.");
  expect(stepFacts(timeline.builds, 99)).toBeNull();
  // The republished file's facts are those of the build its point was fetched through.
  const republished = stepFacts(timeline.builds, 2)!;
  expect(republished.to.fetchedThrough).toBe(timeline.builds[1].buildId);
  expect(republished).toMatchObject({ noStepReason: null, compareUrl: null, targetSetChanged: false });
});

test("links to GitHub are made only from a repository and a commit that look like ones", () => {
  const [build] = smallTimeline({ builds: [{}], outputs: { "baseline/tax": ["currency", [1]] } }).builds;
  const declaring = (codeRepository: string | null, codeCommit: string | null): TimelineBuild => ({
    ...build,
    declared: { ...build.declared!, codeRepository, codeCommit },
  });
  expect(buildFacts(declaring("PolicyEngine/microcosm", "a".repeat(40))).commitUrl)
    .toBe(`https://github.com/PolicyEngine/microcosm/commit/${"a".repeat(40)}`);
  expect(buildFacts(declaring("javascript:alert(1)//x/y", "a".repeat(40))).commitUrl).toBeNull();
  expect(buildFacts(declaring("PolicyEngine/microcosm", "main; rm -rf")).commitUrl).toBeNull();
  expect(buildFacts(declaring(null, "a".repeat(40))).commitUrl).toBeNull();
});

test("packages and declared ranges are read from whatever shape the manifest gave them", () => {
  expect(packageLabel({ name: "policyengine-uk", version: "2.174.1" })).toBe("policyengine-uk 2.174.1");
  expect(packageLabel("policyengine-uk==2.174.1")).toBe("policyengine-uk 2.174.1");
  expect(packageLabel({ name: "policyengine-uk" })).toBe("policyengine-uk");
  expect(packageLabel(null)).toBeNull();
  expect(packageLabel(["policyengine-uk"])).toBeNull();
  expect(compatibleModelsLabel([{ name: "policyengine-uk", specifier: ">=2,<3" }, { name: "policyengine-core" }]))
    .toBe("policyengine-uk >=2,<3, policyengine-core");
  expect(compatibleModelsLabel("anything")).toBeNull();
  expect(compatibleModelsLabel([])).toBeNull();
});
