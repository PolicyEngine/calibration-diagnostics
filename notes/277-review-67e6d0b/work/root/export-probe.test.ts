import { expect, test } from "bun:test";
import * as base from "../tests/isolated-base/src/latest-artifact";
import * as head from "../tests/isolated-head/src/latest-artifact";

test("new property-test helpers are consumer-visible module exports", () => {
  const added = Object.keys(head).filter((key) => !(key in base)).sort();
  console.log(JSON.stringify({ added }));
  expect(added).toEqual(["categoryLevels", "computeDimensions", "countOrNull", "repeatsGeography"]);
});
