import { expect, test } from "bun:test";

import { orderRunOptions, parseRunOrder, withRunOrder } from "@/lib/microcosm/run-order";

const PAGE = "https://example.test/calibration/dashboard/microcosm/staging";

// A list in a given order, which by pipeline the selector shows under each
// run's group (`<optgroup>`s in the order they first appear). The server sends
// its list newest first; these starts are out of order on purpose, so that by
// date the selector has to sort them.
const RUNS = [
  { run_id: "release-nov-3", started_ms: Date.parse("2026-11-03T11:17:33Z"), pipeline_label: "US release build" },
  { run_id: "release-oct-20", started_ms: Date.parse("2026-10-19T22:23:36Z"), pipeline_label: "US release build" },
  { run_id: "acs-nov-6", started_ms: Date.parse("2026-11-06T03:56:42Z"), pipeline_label: "US ACS multispine staging" },
  { run_id: "unknown-start", started_ms: null, pipeline_label: "US ACS multispine staging" },
  { run_id: "release-oct-24", started_ms: Date.parse("2026-10-24T08:33:55Z"), pipeline_label: "US release build" },
];
const GROUP: Record<string, string> = {
  "release-nov-3": "US release build",
  "release-oct-20": "US release build",
  "acs-nov-6": "US ACS multispine staging",
  "unknown-start": "US ACS multispine staging",
  "release-oct-24": "US release build · earlier stage sequence",
};
const groupOf = (run: (typeof RUNS)[number]) => GROUP[run.run_id];

test("by date, the selector lists every run in one list, newest start first", () => {
  const options = orderRunOptions(RUNS, "date", groupOf);

  expect(options.map((option) => option.run.run_id)).toEqual([
    "acs-nov-6",
    "release-nov-3",
    "release-oct-24",
    "release-oct-20",
    // A run whose start is unknown comes last.
    "unknown-start",
  ]);
  expect(options.every((option) => option.group === undefined)).toBe(true);
});

test("by pipeline, the selector keeps the list's order under each run's group", () => {
  const options = orderRunOptions(RUNS, "pipeline", groupOf);

  expect(options.map((option) => [option.run.run_id, option.group])).toEqual(
    RUNS.map((run) => [run.run_id, GROUP[run.run_id]]),
  );
});

test("the order comes from the URL, by pipeline unless it says by date", () => {
  expect(parseRunOrder("date")).toBe("date");
  expect(parseRunOrder("pipeline")).toBe("pipeline");
  expect(parseRunOrder(null)).toBe("pipeline");
  expect(parseRunOrder("anything else")).toBe("pipeline");
});

test("choosing an order keeps it in the URL beside the other parameters", () => {
  const byDate = new URL(withRunOrder(`${PAGE}?view=progress&country=uk&run=abc`, "date"));
  expect(byDate.searchParams.get("order")).toBe("date");
  expect(byDate.searchParams.get("view")).toBe("progress");
  expect(byDate.searchParams.get("country")).toBe("uk");
  expect(byDate.searchParams.get("run")).toBe("abc");

  // By pipeline is the default, so it needs no parameter.
  const byPipeline = new URL(withRunOrder(`${PAGE}?view=progress&order=date`, "pipeline"));
  expect(byPipeline.searchParams.has("order")).toBe(false);
  expect(byPipeline.searchParams.get("view")).toBe("progress");
});

test("by date, runs that start together, or whose starts are unknown, keep the list's order", () => {
  const sameStart = Date.parse("2026-11-03T11:17:33Z");
  // Within each tied pair the later ID and pipeline name come first, so a
  // tie-break by either would fail.
  const runs = [
    { run_id: "unknown-z", started_ms: null, pipeline_label: "B" },
    { run_id: "same-z", started_ms: sameStart, pipeline_label: "B" },
    { run_id: "unknown-a", started_ms: null, pipeline_label: "A" },
    { run_id: "same-a", started_ms: sameStart, pipeline_label: "A" },
  ];

  expect(orderRunOptions(runs, "date", () => undefined).map((option) => option.run.run_id)).toEqual([
    "same-z",
    "same-a",
    "unknown-z",
    "unknown-a",
  ]);
});
