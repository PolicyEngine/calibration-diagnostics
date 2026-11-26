import { expect, test } from "bun:test";

import {
  latestMeasuredBuild,
  stepOf,
  stepSummary,
  typicalStep,
} from "./release-history-moved";
import { outputEntries } from "./release-history-outputs";
import { panelPresentation } from "./release-history-summary";
import { smallTimeline } from "./test-support/release-history-small-timeline";
import { syntheticPanelView } from "./test-support/release-history-synthetic-view";

const PRESENTATION = panelPresentation(null);

function ranked() {
  const timeline = smallTimeline({
    builds: [{}, {}, {}, {}, {}],
    outputs: {
      "baseline/steady": ["currency", [100, 101, 100, 101, 106.05]],
      "baseline/jumpy": ["currency", [100, 110, 99, 109, 120]],
      "baseline/young": ["currency", [null, null, 100, 102, 110]],
      "baseline/hidden": ["currency", [50, 51, 52, 53, "withheld"]],
      "baseline/flat": ["count", [5, 5, 5, 5, 5]],
      "baseline/share": ["rate", [0.1, 0.11, 0.1, 0.11, 0.14]],
      "baseline/still": ["count", [7, 7, 7, 7, 8]],
      "baseline/absent": ["currency", [1, 2, 3, null, null]],
    },
    references: {
      baseline: {
        steady: { status: "resolved", value: 110, sign: 1 },
        jumpy: { status: "resolved", value: 100, sign: 1 },
      },
      reforms: {},
    },
  });
  return { timeline, entries: outputEntries(timeline, PRESENTATION) };
}

test("outputs are ranked by their step beside their own typical step, not by its size", () => {
  const { timeline, entries } = ranked();
  const summary = stepSummary(entries, timeline.builds, 4);
  expect(summary.fromBuildId).toBe("zz-national/b4");
  expect(summary.moved.map((move) => move.entry.id)).toEqual([
    // It never moved before, so any step is beyond its typical one.
    "baseline/still",
    // +5% beside a typical 1%.
    "baseline/steady",
    // +3 points beside a typical 1.
    "baseline/share",
    // +10%: its largest step in size, and an ordinary one for it.
    "baseline/jumpy",
    // One earlier step only: ranked after the others, by the size of its step.
    "baseline/young",
  ]);
  const [still, steady, share, jumpy, young] = summary.moved;
  expect(still).toMatchObject({ typical: 0, ratio: Number.POSITIVE_INFINITY, measure: "percent" });
  expect(steady.signed).toBeCloseTo(5);
  expect(steady.typical).toBeCloseTo(1, 1);
  expect(steady.ratio).toBeCloseTo(5, 0);
  expect(share).toMatchObject({ measure: "points" });
  expect(share.signed).toBeCloseTo(3);
  expect(share.ratio).toBeCloseTo(3);
  expect(jumpy.ratio).toBeCloseTo(1, 0);
  expect(jumpy.size).toBeGreaterThan(steady.size);
  expect(young).toMatchObject({ typical: null, ratio: null });
  expect(summary).toMatchObject({ unchanged: 1, withheld: 1, noStep: 1, sameFile: false, rankedByTypical: true });
});

test("a step is nearer to or further from the official figure, in those words only", () => {
  const { timeline, entries } = ranked();
  const moves = new Map(stepSummary(entries, timeline.builds, 4).moved.map((move) => [move.entry.id, move.official]));
  // 101 to 106.05, beside an official 110.
  expect(moves.get("baseline/steady")).toMatchObject({ direction: "nearer" });
  expect(moves.get("baseline/steady")!.before).toBeCloseTo(9);
  expect(moves.get("baseline/steady")!.after).toBeCloseTo(3.95);
  // 109 to 120, beside an official 100.
  expect(moves.get("baseline/jumpy")).toMatchObject({ direction: "further" });
  // No official figure: nothing is said.
  expect(moves.get("baseline/share")).toBeNull();
});

test("a withheld cell is counted and nothing else: no size, no rank, no typical step from it", () => {
  const { timeline, entries } = ranked();
  const hidden = entries.find((entry) => entry.id === "baseline/hidden")!;
  expect(stepOf(hidden, 4)).toBeNull();
  const summary = stepSummary(entries, timeline.builds, 4);
  expect(summary.moved.some((move) => move.entry.id === "baseline/hidden")).toBe(false);
  expect(summary.withheld).toBe(1);

  // A step out of a withheld cell is withheld too, and is no part of a later typical step.
  const later = smallTimeline({
    builds: [{}, {}, {}, {}, {}, {}],
    outputs: { "baseline/hidden": ["currency", [50, "withheld", 60, 61, 62, 70]] },
  });
  const entry = outputEntries(later, PRESENTATION)[0];
  expect(entry.values.map((value) => value.changeStatus)).toEqual(["none", "withheld", "withheld", "ok", "ok", "ok"]);
  // Two published steps before the last build: too few for a typical step.
  expect(typicalStep(entry, later.builds, 5)).toBeNull();
});

test("a build that republishes a file moves nothing, and is left out of every typical step", () => {
  const timeline = smallTimeline({
    builds: [{}, {}, { sameFileAs: 1 }, {}, {}, {}],
    outputs: { "baseline/tax": ["currency", [100, 102, null, 106.08, 112.4448, 120]] },
  });
  const entries = outputEntries(timeline, PRESENTATION);
  expect(timeline.builds[2].sameFileAs).toBe("zz-national/b2");
  expect(stepSummary(entries, timeline.builds, 2)).toMatchObject({ sameFile: true, moved: [], unchanged: 1 });
  // Steps of 2%, 4% and 6%: their median is 4. With the republished file's zero it would be 3.
  expect(typicalStep(entries[0], timeline.builds, 5)).toBeCloseTo(4);
});

test("a step of nothing is no move even from zero, and a step away from zero ranks first with no percentage", () => {
  const timeline = smallTimeline({
    builds: [{}, {}, {}, {}, {}],
    outputs: {
      "baseline/nothing": ["currency", [0, 0, 0, 0, 0]],
      "baseline/appears": ["currency", [0, 0, 0, 0, 12]],
      "baseline/ordinary": ["currency", [100, 101, 102, 103, 104]],
    },
  });
  const entries = outputEntries(timeline, PRESENTATION);
  const summary = stepSummary(entries, timeline.builds, 4);
  expect(summary).toMatchObject({ unchanged: 1, noStep: 0, withheld: 0 });
  expect(summary.moved.map((move) => move.entry.id)).toEqual(["baseline/appears", "baseline/ordinary"]);
  expect(summary.moved[0]).toMatchObject({ signed: Number.POSITIVE_INFINITY, typical: 0, ratio: Number.POSITIVE_INFINITY });
  // An infinite step never enters a typical step.
  const later = smallTimeline({
    builds: [{}, {}, {}, {}, {}, {}],
    outputs: { "baseline/appears": ["currency", [0, 5, 5.05, 5.1, 5.151, 6]] },
  });
  expect(typicalStep(outputEntries(later, PRESENTATION)[0], later.builds, 5)).toBeCloseTo(1, 1);
});

test("what moved speaks of the newest measured build on the axis", () => {
  const timeline = smallTimeline({
    builds: [{}, {}, { withdrawn: true }, { unmeasured: true }],
    outputs: { "baseline/tax": ["currency", [1, 2, 3, null]] },
  });
  expect(latestMeasuredBuild(timeline.builds)).toBe(1);
  expect(latestMeasuredBuild(smallTimeline({ builds: [{ unmeasured: true }], outputs: {} }).builds)).toBeNull();
});

test("a series too short for typical steps is ranked by the size of its steps", () => {
  const timeline = smallTimeline({
    builds: [{}, {}, {}],
    outputs: {
      "baseline/small": ["currency", [100, 100, 101]],
      "baseline/large": ["currency", [100, 100, 109]],
    },
  });
  const summary = stepSummary(outputEntries(timeline, PRESENTATION), timeline.builds, 2);
  expect(summary.rankedByTypical).toBe(false);
  expect(summary.moved.map((move) => move.entry.id)).toEqual(["baseline/large", "baseline/small"]);
});

test("on the synthetic UK panel every output is ranked, unchanged, withheld, or has no step", async () => {
  const { timeline, presentation } = await syntheticPanelView("uk");
  const entries = outputEntries(timeline, presentation);
  const latest = latestMeasuredBuild(timeline.builds)!;
  // The served panel never ran the two newest builds.
  expect(timeline.builds[latest].publishedAt).toBe("2026-11-10T09:31:00+00:00");

  // The build after a gap: its neighbour holds no value, so no output has a step to it.
  const gap = timeline.builds.findIndex((build) => build.state === "gap");
  const afterGap = stepSummary(entries, timeline.builds, gap + 1);
  expect(afterGap.moved).toEqual([]);
  expect(afterGap.noStep + afterGap.withheld).toBe(entries.length);

  // The build where the target set changes: outputs moved, largest ratio first.
  const index = timeline.builds.findIndex((build) => build.publishedAt === "2026-11-02T02:04:00+00:00");
  const all = stepSummary(entries, timeline.builds, index);
  expect(all.moved.length + all.unchanged + all.withheld + all.noStep).toBe(entries.length);
  expect(all.moved.length).toBeGreaterThan(10);
  expect(all.withheld).toBeGreaterThan(0);
  // The step runs from the build before the withdrawn one, which is no neighbour.
  expect(timeline.builds[index - 1].withdrawn).toBe(true);
  expect(all.fromBuildId).toBe(timeline.builds[index - 2].buildId);
  for (const move of all.moved) expect(move.entry.values[index].status).toBe("ok");

  // At the latest build the series is long enough for typical steps.
  const atLatest = stepSummary(entries, timeline.builds, latest);
  expect(atLatest.rankedByTypical).toBe(true);
  const ratios = atLatest.moved.filter((move) => move.ratio !== null).map((move) => move.ratio!);
  expect(ratios.length).toBeGreaterThan(10);
  expect(ratios).toEqual([...ratios].sort((left, right) => right - left));
  const headline = stepSummary(entries.filter((entry) => entry.headline), timeline.builds, latest);
  expect(headline.moved.every((move) => move.entry.headline)).toBe(true);
  expect(headline.moved.length).toBeLessThan(atLatest.moved.length);
});
