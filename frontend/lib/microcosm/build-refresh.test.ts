import { expect, test } from "bun:test";

import { buildListRefetchInterval, buildRunRefetchInterval } from "@/lib/microcosm/build-refresh";

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
