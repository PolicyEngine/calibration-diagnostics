import { expect, test } from "bun:test";

import type { CalibrationTreeComparisonTargetDetailResponse } from "@/lib/microcosm/calibration-tree-artifact";
import {
  createCalibrationComparisonTargetDetailHandler,
  type CalibrationComparisonTargetDetailRouteDependencies,
} from "./route";

const BUILD = "a".repeat(64);

function response(): CalibrationTreeComparisonTargetDetailResponse {
  return {
    schemaVersion: 6,
    country: "us",
    buildArtifactId: BUILD,
    targetOrdinal: 7,
    targetId: "snap",
    target: {
      name: "snap",
      base_name: "snap",
      comparison_id: "snap",
      match_kind: "base_name",
      current_name: "snap",
      candidate_name: "snap",
      current_representation: "hierarchy",
      candidate_representation: "hierarchy",
      current_target_ordinal: 3,
      candidate_target_ordinal: 4,
      comparison_status: "shared",
      comparison_fit: "unchanged",
      current: null,
      candidate: null,
      currentDetail: { name: "snap", target: 100 },
      candidateDetail: { name: "snap", target: 101 },
      reported_change: 0,
      pooled_weight_share: null,
      shared_current_contribution: null,
      shared_candidate_contribution: null,
      shared_change: null,
    },
  };
}

test("returns one source-backed comparison target with immutable caching", async () => {
  const calls: unknown[] = [];
  const handler = createCalibrationComparisonTargetDetailHandler({
    loadTargetDetail: (async (options) => {
      calls.push(options);
      return response();
    }) as CalibrationComparisonTargetDetailRouteDependencies["loadTargetDetail"],
  });
  const result = await handler(new Request(
    `https://dashboard.example/api/microcosm/comparison-tree/target-detail?country=us&build=${BUILD}&target=7`,
  ));

  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(response());
  expect(result.headers.get("cache-control")).toContain("immutable");
  expect(calls).toEqual([{
    country: "us",
    buildArtifactId: BUILD,
    targetOrdinal: 7,
  }]);
});

test("rejects invalid parameters before reading Blob storage", async () => {
  let called = false;
  const handler = createCalibrationComparisonTargetDetailHandler({
    loadTargetDetail: (async () => {
      called = true;
      return response();
    }) as CalibrationComparisonTargetDetailRouteDependencies["loadTargetDetail"],
  });
  const result = await handler(new Request(
    `https://dashboard.example/api/microcosm/comparison-tree/target-detail?country=us&build=${BUILD}&target=-1`,
  ));

  expect(result.status).toBe(400);
  expect(called).toBe(false);
});
