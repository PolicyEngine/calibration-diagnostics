import { expect, test } from "bun:test";

import { fetchCalibrationTreeTiersConcurrently } from "./use-microcosm";

test("calibration tree tier requests start without waiting for earlier tiers", async () => {
  const started: string[] = [];
  const resolve = new Map<string, () => void>();
  let completed = false;

  const loading = fetchCalibrationTreeTiersConcurrently(
    ["tier-1", "tier-2", "tier-3"],
    (tier) => {
      started.push(tier);
      return new Promise<void>((done) => resolve.set(tier, done));
    },
  );
  void loading.then(() => {
    completed = true;
  });

  expect(started).toEqual(["tier-1", "tier-2", "tier-3"]);
  resolve.get("tier-3")!();
  resolve.get("tier-1")!();
  await Promise.resolve();
  expect(completed).toBe(false);

  resolve.get("tier-2")!();
  await loading;
  expect(completed).toBe(true);
});
