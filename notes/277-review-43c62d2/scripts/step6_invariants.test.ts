// Step 6: generated-input checks of the readers #277 adds. Runs in a scratch
// copy of 43c62d2 whose latest-artifact.ts also exports the private helpers
// (see step6.sh). fast-check 4.10.2 is already a calibration-tree dependency.
import { expect, test } from "bun:test";
import fc from "fast-check";

import {
  __categoryLevels as categoryLevels,
  __computeDimensions as computeDimensions,
  __countOrNull as countOrNull,
  __repeatsGeography as repeatsGeography,
} from "./latest-artifact";
import { statisticGroupKey } from "../../../lib/microcosm/statistic-groups";

const RUNS = 20_000;
const SEED = 277;
const params = { numRuns: RUNS, seed: SEED, endOnFailure: false };
const isCount = (v: unknown) => v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0));

const countLike = fc.oneof(
  fc.anything(),
  fc.double(),
  fc.integer(),
  fc.bigInt().map(String),
  fc.string(),
  fc.stringMatching(/^\s*-?[0-9]{0,20}(\.[0-9]{0,3})?(e[0-9]{1,3})?\s*$/),
  fc.constantFrom("", " ", "\n", "-0", "0x10", "1e3", "Infinity", "NaN", "2.5", "-1", "9007199254740992", "٣", " 7 ", "﻿7"),
);

test("countOrNull returns null or a safe non-negative integer", () => {
  fc.assert(fc.property(countLike, (v) => isCount(countOrNull(v))), params);
});

test("countOrNull reads n and String(n) as n", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) =>
      countOrNull(n) === n && countOrNull(String(n)) === n),
    params,
  );
});

const levelValue = fc.oneof(
  fc.constantFrom("country", "state", "national", "region", "", null, undefined, " "),
  fc.string({ maxLength: 4 }),
  fc.integer({ min: -2, max: 2 }),
);
const group = fc.array(fc.record({ level: levelValue }), { maxLength: 8 });

for (const none of ["", null] as const) {
  test(`categoryLevels: sorted, unique, non-empty levels; level null exactly when two or more (none = ${JSON.stringify(none)})`, () => {
    fc.assert(
      fc.property(group, (rows) => {
        const { level, levels } = categoryLevels(rows as never, none);
        const sorted = [...levels].sort();
        expect(levels).toEqual(sorted);
        expect(new Set(levels).size).toBe(levels.length);
        expect(levels.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
        expect(level === null).toBe(levels.length >= 2);
      }),
      params,
    );
  });
}

test("statisticGroupKey equals the old key for every single-level row", () => {
  const token = fc.oneof(fc.constantFrom("ed_fsa", "irs_soi", "snap", "a::b", "x+y"), fc.string({ maxLength: 6 }));
  fc.assert(
    fc.property(token, fc.oneof(fc.constant(""), token), token, (source, level, variable) => {
      const levels = level ? [level] : [];
      const row = { source, variable, level, levels };
      return statisticGroupKey(row) === [source, level, variable].join("::");
    }),
    params,
  );
});

// The variable row the targets API writes for one category, and the old key
// base wrote for it from its first row (latest-artifact.ts:1526 at 2306113).
test("for a category at one level, the new key equals the key base gave it", () => {
  fc.assert(
    fc.property(fc.array(fc.record({ level: levelValue }), { minLength: 1, maxLength: 6 }), (rows) => {
      const shown = categoryLevels(rows as never, "");
      fc.pre(shown.levels.length <= 1);
      const oldKey = ["s", String(rows[0].level ?? ""), "v"].join("::");
      return statisticGroupKey({ source: "s", variable: "v", ...shown }) === oldKey;
    }),
    params,
  );
});

const geographies = ["United States", "Alabama", "Alaska", "Wales", "Flanders"];
const facetRow = fc.record({
  geography: fc.oneof(fc.constantFrom(...geographies), fc.constant(""), fc.constant(undefined)),
  level: fc.constantFrom("country", "state", "region"),
  dims: fc.array(
    fc.record({
      key: fc.constantFrom("loc", "sex", "age"),
      value: fc.oneof(fc.constantFrom(...geographies), fc.constantFrom("Male", "Female", "18-64"), fc.constant("")),
    }),
    { maxLength: 3 },
  ),
}).map((r) => ({
  geography: r.geography,
  level: r.level,
  target_dimensions: [...new Map(r.dims.map((d) => [d.key, { ...d, label: d.key }])).values()],
}));

test("repeatsGeography never hides Geography, nor a dimension that differs from some row's geography", () => {
  fc.assert(
    fc.property(fc.array(facetRow, { maxLength: 10 }), (rows) => {
      const facets = computeDimensions(rows as never).map((f: { key: string }) => f.key);
      const geographyValues = new Set(rows.map((r) => r.geography).filter(Boolean));
      if (geographyValues.size > 1) expect(facets).toContain("geography");
      expect(repeatsGeography(rows as never, "geography")).toBe(
        rows.some((r) => r.geography) ? true : false,
      );
      for (const key of ["loc", "sex", "age"]) {
        const differs = rows.some((r) => {
          const d = r.target_dimensions.find((x) => x.key === key);
          return d && d.value && d.value !== (r.geography || undefined);
        });
        if (differs) expect(repeatsGeography(rows as never, key)).toBe(false);
        const values = new Set(rows.map((r) => r.target_dimensions.find((x) => x.key === key)?.value).filter(Boolean));
        if (differs && values.size > 1) expect(facets).toContain(key);
      }
    }),
    params,
  );
});
