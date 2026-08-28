import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { createExplorerState } from "./calibration-explorer";
import { buildCalibrationTree } from "./calibration-tree";
import { buildCalibration } from "./latest-artifact";

const RELEASE_ID =
  "populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z";

function legacyIdentityFixture(): Record<string, unknown> {
  const compressed = readFileSync(
    new URL("./fixtures/us-legacy-target-identities.json.gz", import.meta.url),
  );
  return JSON.parse(gunzipSync(compressed).toString("utf8"));
}

test("the pinned US release retains its legacy source and statistic grouping", () => {
  const calibration = buildCalibration(legacyIdentityFixture(), RELEASE_ID);
  const tree = buildCalibrationTree(calibration.rows, createExplorerState());
  const nodeCounts = Object.fromEntries(
    tree.groups.map((group) => [group.id, group.nodes.length]),
  );

  expect(calibration.target_schema.target_representation).toBe("legacy");
  expect(calibration.rows).toHaveLength(5_659);
  expect(tree.groups).toHaveLength(15);
  expect(Object.values(nodeCounts).reduce((sum, count) => sum + count, 0)).toBe(53);
  expect(nodeCounts).toEqual({
    irs_soi: 33,
    census_population: 1,
    cms_medicaid: 3,
    ssa: 2,
    usda_snap: 2,
    cms_aca: 2,
    state_income_tax: 1,
    hhs_acf_tanf: 1,
    jct: 1,
    cbo: 1,
    bea: 2,
    cms_medicare: 1,
    federal_reserve: 1,
    hhs_acf_liheap: 1,
    unspecified: 1,
  });
  expect(tree.groups.find((group) => group.id === "bea")?.nodes.map((node) => node.label))
    .toEqual(["Amount", "Wages salaries"]);
});
