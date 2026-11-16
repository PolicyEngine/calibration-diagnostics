import { expect, test } from "bun:test";

import { buildListRefetchInterval, buildRunRefetchInterval, detailBehindList } from "@/lib/microcosm/build-refresh";

test("a running hosted run is asked for again every minute, and any other run never", () => {
  expect(buildRunRefetchInterval("staging", "running")).toBe(60 * 1000);
  for (const state of ["passed", "failed", "blocked", "stalled"] as const) {
    expect(buildRunRefetchInterval("staging", state)).toBe(false);
  }
  expect(buildRunRefetchInterval("staging", undefined)).toBe(false);
});

test("a running local run is asked for every 10 seconds, as reading it is free, and a finished one never", () => {
  expect(buildRunRefetchInterval("local", "running")).toBe(10 * 1000);
  expect(buildRunRefetchInterval("local", "passed")).toBe(false);
});

test("the hosted run list is asked for again every five minutes", () => {
  expect(buildListRefetchInterval("staging")).toBe(5 * 60 * 1000);
  expect(buildListRefetchInterval("local")).toBe(10 * 1000);
});

test("a run whose detail request failed is asked for again every minute", () => {
  expect(buildRunRefetchInterval("staging", undefined, true)).toBe(60 * 1000);
  expect(buildRunRefetchInterval("local", undefined, true)).toBe(10 * 1000);
});

test("the run is asked for again when the newer run list gives it another state", () => {
  // A run that went quiet for five minutes and then resumed.
  expect(detailBehindList("running", "stalled")).toBe(true);
  expect(detailBehindList("passed", "running")).toBe(true);
  expect(detailBehindList("stalled", "stalled")).toBe(false);
  // A run older than the list.
  expect(detailBehindList(undefined, "stalled")).toBe(false);
  expect(detailBehindList("running", undefined)).toBe(false);
});
