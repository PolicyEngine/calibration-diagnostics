import { expect, test } from "bun:test";

import { createStagingTargetChangeTreeHandler } from "./route";

const BUILD_ID = "a".repeat(64);

test("compares a live candidate with an exact immutable staging build", async () => {
  const calls: unknown[][] = [];
  const handler = createStagingTargetChangeTreeHandler({
    loadReleaseDataset: async (...args) => {
      throw new Error(`Unexpected release loader call: ${String(args)}`);
    },
    loadBuildDataset: async (...args) => {
      calls.push(args);
      return null;
    },
  });

  const response = await handler(new Request(
    "https://dashboard.example/api/microcosm/staging/target-change-tree?" +
      `country=uk&run=live-uk-candidate&build=${BUILD_ID}&mode=reported`,
  ));

  expect(response.status).toBe(200);
  expect(calls).toEqual([["live-uk-candidate", BUILD_ID, "uk"]]);
  expect(await response.json()).toEqual({
    available: false,
    reason: "This staging run has not uploaded calibration diagnostics yet.",
  });
});

test("retains the resolved-release comparison path", async () => {
  const calls: unknown[][] = [];
  const handler = createStagingTargetChangeTreeHandler({
    loadReleaseDataset: async (...args) => {
      calls.push(args);
      return null;
    },
    loadBuildDataset: async (...args) => {
      throw new Error(`Unexpected build loader call: ${String(args)}`);
    },
  });

  const response = await handler(new Request(
    "https://dashboard.example/api/microcosm/staging/target-change-tree?" +
      "country=us&run=live-us-candidate&release=release-20260920&mode=shared",
  ));

  expect(response.status).toBe(200);
  expect(calls).toEqual([["live-us-candidate", "release-20260920", "us"]]);
});

test("rejects ambiguous or malformed current-build selectors", async () => {
  const handler = createStagingTargetChangeTreeHandler({
    loadReleaseDataset: async () => null,
    loadBuildDataset: async () => null,
  });
  const ambiguous = await handler(new Request(
    "https://dashboard.example/api/microcosm/staging/target-change-tree?" +
      `run=candidate&release=release-a&build=${BUILD_ID}`,
  ));
  const malformed = await handler(new Request(
    "https://dashboard.example/api/microcosm/staging/target-change-tree?" +
      "run=candidate&build=not-a-build-id",
  ));

  expect(ambiguous.status).toBe(400);
  expect(malformed.status).toBe(400);
});
