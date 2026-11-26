import { expect, test } from "bun:test";

import { buildMarks } from "./release-history-builds";
import { chartLayout, columnBand, niceTicks, sparklinePath } from "./release-history-chart";
import { dateShort, versusOfficial } from "./release-history-format";
import { outputEntries, type OutputEntry } from "./release-history-outputs";
import type { Timeline } from "./release-history-store";
import { panelPresentation } from "./release-history-summary";
import type { ChartScale } from "./release-history-url";
import { smallTimeline } from "./test-support/release-history-small-timeline";
import { syntheticPanelView } from "./test-support/release-history-synthetic-view";

async function ukChart(output: string, scale: ChartScale, engine: "earlier" | "newer" = "earlier", width = 960) {
  const { timeline, presentation } = await syntheticPanelView("uk", engine);
  const entry = outputEntries(timeline, presentation).find((candidate) => candidate.id === output)!;
  const layout = chartLayout({
    builds: timeline.builds,
    entry,
    scale,
    currency: presentation.currency,
    marks: buildMarks(timeline.builds),
    width,
  });
  return { timeline, entry, layout };
}

function small(timeline: Timeline, scale: ChartScale = "relative") {
  const [entry] = outputEntries(timeline, panelPresentation(null));
  return {
    entry,
    layout: chartLayout({ builds: timeline.builds, entry, scale, currency: "GBP", marks: buildMarks(timeline.builds), width: 600 }),
  };
}

const at = (timeline: Timeline, date: string) =>
  timeline.builds.findIndex((build) => dateShort(build.publishedAt) === date);

test("the relative view places each value as a percentage of the official figure, with the figure at 0%", async () => {
  const { timeline, entry, layout } = await ukChart("baseline/income_tax", "relative");
  expect(layout).toMatchObject({ relative: true, blocked: false, empty: false });
  expect(layout.official!.label).toStartWith("0% = official £");
  expect(layout.ticks.every((tick) => tick.label === "0%" || tick.label.endsWith("%"))).toBe(true);
  expect(layout.ticks.some((tick) => Math.abs(tick.y - layout.official!.y) < 1e-6 && tick.label === "0%")).toBe(true);
  // Two values, two heights: the higher value is drawn higher.
  const [first, second] = [0, 1].map((index) => ({
    versus: versusOfficial(entry.values[index].value!, entry.official!),
    y: layout.columns[index].point!.y,
  }));
  expect(Math.sign(first.versus - second.versus)).toBe(Math.sign(second.y - first.y));
  // The latest value is the one labelled, as a percentage; the two newest builds have no run here.
  const latest = at(timeline, "10 Nov");
  expect(layout.latestLabel).toMatchObject({ x: layout.columns[latest].x, anchor: "middle" });
  expect(layout.latestLabel!.text).toMatch(/^[+−]\d+\.\d\d%$/);
});

test("the absolute view places the values, and keeps the official figure on the scale", async () => {
  const { layout } = await ukChart("baseline/income_tax", "absolute");
  expect(layout).toMatchObject({ relative: false, blocked: false });
  expect(layout.official!.label).toStartWith("Official £");
  expect(layout.ticks.every((tick) => tick.label.startsWith("£"))).toBe(true);
  expect(layout.official!.y).toBeGreaterThanOrEqual(layout.plot.top);
  expect(layout.official!.y).toBeLessThanOrEqual(layout.plot.bottom);
  expect(layout.latestLabel!.text).toStartWith("£");
});

test("an output with no official figure is drawn in values under both views, and says the relative one could not be", async () => {
  const relative = await ukChart("reform/basic_rate_plus_1p/budgetary_impact", "relative");
  expect(relative.layout).toMatchObject({ relative: false, blocked: true, official: null });
  const absolute = await ukChart("reform/basic_rate_plus_1p/budgetary_impact", "absolute");
  expect(absolute.layout).toMatchObject({ relative: false, blocked: false, official: null });
  expect(relative.layout.columns.map((column) => column.point?.y)).toEqual(
    absolute.layout.columns.map((column) => column.point?.y),
  );
});

test("every build keeps its column: a build with no value is shaded and labelled with why", async () => {
  const served = await ukChart("baseline/income_tax", "relative");
  const band = (date: string) => served.layout.columns[at(served.timeline, date)];
  expect(served.layout.columns).toHaveLength(served.timeline.builds.length);
  expect(band("24 Oct")).toMatchObject({ band: "gap", point: null });
  expect(band("17 Nov")).toMatchObject({ band: "not measured", point: null });
  expect(band("24 Nov")).toMatchObject({ band: "not measured", point: null, current: true });
  expect(band("19 Oct")).toMatchObject({ band: null });
  // Measured before it was withdrawn: its column is shaded and its value is a hollow marker.
  expect(band("29 Oct")).toMatchObject({ band: "withdrawn", point: { hollow: true } });

  const pinned = await ukChart("baseline/income_tax", "relative", "newer");
  const pinnedBand = (date: string) => pinned.layout.columns[at(pinned.timeline, date)];
  // Never measured on the newer engine, which was pinned after the withdrawal.
  expect(pinnedBand("29 Oct")).toMatchObject({ band: "withdrawn", point: null });
  expect(pinnedBand("5 Nov")).toMatchObject({ band: "failed", point: null });
  expect(pinnedBand("24 Nov")).toMatchObject({ band: "retrying", point: null });
  expect(pinnedBand("17 Nov")).toMatchObject({ band: null });
  // The axis is the same on both engines.
  expect(pinned.layout.columns.map((column) => column.x)).toEqual(served.layout.columns.map((column) => column.x));
});

test("a line joins two builds only where the timeline has a step between them", async () => {
  const { timeline, layout } = await ukChart("baseline/income_tax", "relative");
  const joined = layout.segments.map((segment) =>
    `${dateShort(timeline.builds[segment.from].publishedAt)} → ${dateShort(timeline.builds[segment.to].publishedAt)}`
  );
  expect(joined).toEqual([
    "19 Oct → 21 Oct",
    // The same file, published again: a flat step.
    "21 Oct → 21 Oct",
    // No line into or out of the gap, and none to or from the withdrawn build: 27 Oct joins 2 Nov.
    "27 Oct → 2 Nov",
    "2 Nov → 5 Nov",
    "5 Nov → 7 Nov",
    "7 Nov → 10 Nov",
  ]);
  const flat = layout.segments[1];
  expect(flat.y1).toBe(flat.y2);
});

test("a withheld cell has a shaded column and no point, whatever the document carries", async () => {
  // Withheld in some builds only: the fixture's two measured points differ in this cell.
  const output = "baseline/household_net_income_mean/decile_1";
  const { timeline, entry, layout } = await ukChart(output, "absolute");
  const statuses = entry.values.map((value) => value.status);
  expect(statuses).toContain("withheld");
  expect(statuses).toContain("ok");
  layout.columns.forEach((column, index) => {
    if (statuses[index] !== "withheld" || timeline.builds[index].withdrawn) return;
    expect(column).toMatchObject({ band: "withheld", point: null });
  });
  // No line reaches a withheld cell.
  for (const segment of layout.segments) {
    expect([statuses[segment.from], statuses[segment.to]]).toEqual(["ok", "ok"]);
  }

  // A document that wrongly carried a number beside the withheld status draws nothing with it.
  const leaking: Timeline = structuredClone(timeline);
  const raw = leaking.outputs.find((candidate) => candidate.output === output)!;
  const hidden = raw.values.findIndex((value) => value.status === "withheld");
  raw.values[hidden].value = 9.87e12;
  const leaked = outputEntries(leaking, panelPresentation(null)).find((candidate) => candidate.id === output)!;
  const drawn = chartLayout({ builds: leaking.builds, entry: leaked, scale: "absolute", currency: "GBP", marks: [], width: 960 });
  expect(drawn.columns[hidden].point).toBeNull();
  expect(drawn.ticks.map((tick) => tick.label)).toEqual(layout.ticks.map((tick) => tick.label));
});

test("why a column is empty follows the build's state and the cell's status", () => {
  const build = smallTimeline({ builds: [{}], outputs: { "baseline/tax": ["currency", [1]] } }).builds[0];
  expect(columnBand(build, "ok")).toBeNull();
  expect(columnBand(build, "withheld")).toBe("withheld");
  // A measured build whose point has no such cell, as after a reform that failed.
  expect(columnBand(build, "missing")).toBe("no value");
  expect(columnBand({ ...build, state: "missing" }, "unmeasured")).toBe("not measured");
  expect(columnBand({ ...build, state: "gap" }, "unmeasured")).toBe("gap");
  expect(columnBand({ ...build, withdrawn: true }, "ok")).toBe("withdrawn");
});

test("dates under the axis thin out where columns are narrow, and the current build always has one", async () => {
  const wide = await ukChart("baseline/income_tax", "relative", "earlier", 1200);
  expect(wide.layout.columns.every((column) => column.dateLabel !== null)).toBe(true);
  // Twelve columns of 92px hold "not measured" on one line; narrower ones turn it on its side.
  expect(wide.layout.verticalBandLabels).toBe(false);
  const narrow = await ukChart("baseline/income_tax", "relative", "earlier", 360);
  const labelled = narrow.layout.columns.filter((column) => column.dateLabel !== null);
  expect(labelled.length).toBeLessThan(narrow.layout.columns.length);
  expect(labelled.some((column) => column.current)).toBe(true);
  expect(narrow.layout.verticalBandLabels).toBe(true);
  // Labelled dates never sit closer than a date is wide.
  for (let index = 1; index < labelled.length; index += 1) {
    expect(labelled[index].x - labelled[index - 1].x).toBeGreaterThanOrEqual(46);
  }
  // The marks ride on their columns.
  expect(wide.layout.columns[at(wide.timeline, "2 Nov")].marks).toEqual(["new_build_engine"]);
});

test("an output no build holds a value for has an empty chart, with its columns", () => {
  const timeline = smallTimeline({
    builds: [{}, { unmeasured: true }],
    outputs: { "baseline/tax": ["currency", ["withheld", null]] },
  });
  const { layout } = small(timeline);
  expect(layout).toMatchObject({ empty: true, ticks: [], official: null, latestLabel: null, segments: [] });
  expect(layout.columns.map((column) => column.band)).toEqual(["withheld", "not measured"]);
});

test("one value still gets a scale around it", () => {
  const { layout } = small(smallTimeline({ builds: [{}], outputs: { "baseline/tax": ["currency", [100]] } }), "absolute");
  expect(layout.ticks.length).toBeGreaterThan(1);
  expect(layout.columns[0].point!.y).toBeGreaterThan(layout.plot.top);
  expect(layout.columns[0].point!.y).toBeLessThan(layout.plot.bottom);
  expect(layout.latestLabel).toMatchObject({ text: "£100", anchor: "end" });
});

test("axis values are round and cover the range", () => {
  expect(niceTicks(-3.2, 4.1)).toEqual({ ticks: [-4, -2, 0, 2, 4, 6], min: -4, max: 6 });
  expect(niceTicks(0, 10)).toEqual({ ticks: [0, 2.5, 5, 7.5, 10], min: 0, max: 10 });
  const flat = niceTicks(5, 5);
  expect(flat.min).toBeLessThan(5);
  expect(flat.max).toBeGreaterThan(5);
});

test("a sparkline breaks where a build holds no value and passes over a withdrawn one", async () => {
  const { timeline, entry } = await ukChart("baseline/income_tax", "relative");
  const { path, last } = sparklinePath(entry, timeline.builds);
  // 19 Oct to 21 Oct (twice), a break at the gap, then 27 Oct on to 10 Nov over the withdrawn build.
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path.match(/L/g)).toHaveLength(2 + 4);
  expect(last).not.toBeNull();
  const none: OutputEntry = { ...entry, values: entry.values.map((value) => ({ ...value, value: null })) };
  expect(sparklinePath(none, timeline.builds)).toEqual({ path: "", last: null });
});
