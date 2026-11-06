import { expect, test } from "bun:test";

import { hostedListRequested, localListRequested, opensLocalRuns } from "@/lib/microcosm/build-list-requests";

test("without local runs the hosted list is requested at once and the local list not at all", () => {
  // The hosted dashboard never has a local runs folder.
  expect(localListRequested(false, false)).toBe(false);
  expect(hostedListRequested(false, "staging", true)).toBe(true);
  expect(hostedListRequested(false, "staging", false)).toBe(true);
});

test("with local runs the hosted list waits for the local list, which may be preferred", () => {
  expect(localListRequested(true, false)).toBe(true);
  expect(hostedListRequested(true, "staging", true)).toBe(false);
  expect(hostedListRequested(true, "staging", false)).toBe(true);
  expect(hostedListRequested(true, "local", false)).toBe(false);
});

test("a local runs folder the server reports at run time turns the local list on", () => {
  // The page was prerendered without the folder, but the server that answers
  // the hosted list has one: its answer says so.
  expect(localListRequested(false, true)).toBe(true);
});

test("local runs found only through the hosted list's answer are offered, not opened", () => {
  // The hosted runs are already on screen by then; the source switch offers
  // the local ones.
  expect(opensLocalRuns(false, true, ["local-run"], undefined)).toBe(false);
  // A folder the page knew of opens local runs first, as before, unless the
  // run carried over from the Candidate tab is a hosted one.
  expect(opensLocalRuns(true, true, ["local-run"], undefined)).toBe(true);
  expect(opensLocalRuns(true, true, ["local-run"], "hosted-run")).toBe(false);
  expect(opensLocalRuns(true, false, [], undefined)).toBe(false);
});
