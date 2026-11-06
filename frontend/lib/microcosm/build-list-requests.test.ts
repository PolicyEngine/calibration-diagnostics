import { expect, test } from "bun:test";

import { buildListRequests } from "@/lib/microcosm/build-list-requests";

test("without local runs the hosted list is requested at once and the local list not at all", () => {
  // The hosted dashboard never has a local runs folder.
  expect(buildListRequests(false, "staging", true)).toEqual({ local: false, staging: true });
  expect(buildListRequests(false, "staging", false)).toEqual({ local: false, staging: true });
});

test("with local runs the hosted list waits for the local list, which may be preferred", () => {
  expect(buildListRequests(true, "staging", true)).toEqual({ local: true, staging: false });
  expect(buildListRequests(true, "staging", false)).toEqual({ local: true, staging: true });
  expect(buildListRequests(true, "local", false)).toEqual({ local: true, staging: false });
});
