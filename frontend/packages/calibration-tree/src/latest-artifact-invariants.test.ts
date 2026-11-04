import { expect, test } from "bun:test";
import fc from "fast-check";

import {
  categoryLevels,
  computeDimensions,
  countOrNull,
  repeatsGeography,
} from "./latest-artifact";

// Generated-input checks of the readers that #277 adds, from the independent
// review's scoped run (fast-check, seed 277, 20,000 runs each). Each holds
// within the scope its comment states; outside it, the review's strict run
// found the counterexample the comment names, each by design.
const params = { numRuns: 20_000, seed: 277, endOnFailure: false };

// Out of scope: countOrNull(-0) returns -0, which JSON writes as 0.
const isCount = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

const countLike = fc.oneof(
  fc.anything(),
  fc.double(),
  fc.integer(),
  fc.bigInt().map(String),
  fc.string(),
  fc.stringMatching(/^\s*-?[0-9]{0,20}(\.[0-9]{0,3})?(e[0-9]{1,3})?\s*$/),
  fc.constantFrom(
    "",
    " ",
    "\n",
    "-0",
    "0x10",
    "1e3",
    "Infinity",
    "NaN",
    "2.5",
    "-1",
    "9007199254740992",
    "٣",
    " 7 ",
    "﻿7",
  ),
);

test("countOrNull returns null or a safe non-negative integer", () => {
  fc.assert(fc.property(countLike, (value) => isCount(countOrNull(value))), params);
});

test("countOrNull reads n and String(n) as n", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      (n) => countOrNull(n) === n && countOrNull(String(n)) === n,
    ),
    params,
  );
});

const levelValue = fc.oneof(
  fc.constantFrom("country", "state", "national", "region", "", null, undefined, " "),
  fc.string({ maxLength: 4 }),
  fc.integer({ min: -2, max: 2 }),
);
const category = fc.array(fc.record({ level: levelValue }), { maxLength: 8 });

// Out of scope: with none = null (the comparison's) and no level at all, a
// category reads level null, as one at two levels does, by design.
for (const none of ["", null] as const) {
  test(`categoryLevels: sorted, unique, non-empty levels; level null exactly when two or more (none = ${JSON.stringify(none)})`, () => {
    fc.assert(
      fc.property(category, (rows) => {
        const { level, levels } = categoryLevels(rows as never, none);
        expect(levels).toEqual([...levels].sort());
        expect(new Set(levels).size).toBe(levels.length);
        expect(levels.every((value) => typeof value === "string" && value.length > 0)).toBe(true);
        if (levels.length > 0 || none !== null) expect(level === null).toBe(levels.length >= 2);
      }),
      params,
    );
  });
}

const geographies = ["United States", "Alabama", "Alaska", "Wales", "Flanders"];
const facetRow = fc
  .record({
    geography: fc.oneof(fc.constantFrom(...geographies), fc.constant(""), fc.constant(undefined)),
    level: fc.constantFrom("country", "state", "region"),
    dims: fc.array(
      fc.record({
        key: fc.constantFrom("loc", "sex", "age"),
        value: fc.oneof(
          fc.constantFrom(...geographies),
          fc.constantFrom("Male", "Female", "18-64"),
          fc.constant(""),
        ),
      }),
      { maxLength: 3 },
    ),
  })
  .map((row) => ({
    geography: row.geography,
    level: row.level,
    target_dimensions: [
      ...new Map(row.dims.map((dim) => [dim.key, { ...dim, label: dim.key }])).values(),
    ],
  }));

test("repeatsGeography never hides Geography, nor a dimension that differs from some row's geography", () => {
  fc.assert(
    fc.property(fc.array(facetRow, { maxLength: 10 }), (rows) => {
      const facets = computeDimensions(rows as never).map((facet) => facet.key);
      const geographyValues = new Set(rows.map((row) => row.geography).filter(Boolean));
      if (geographyValues.size > 1) expect(facets).toContain("geography");
      expect(repeatsGeography(rows as never, "geography")).toBe(
        rows.some((row) => row.geography),
      );
      for (const key of ["loc", "sex", "age"]) {
        const differs = rows.some((row) => {
          const dim = row.target_dimensions.find((candidate) => candidate.key === key);
          return dim && dim.value && dim.value !== (row.geography || undefined);
        });
        if (differs) expect(repeatsGeography(rows as never, key)).toBe(false);
        const values = new Set(
          rows
            .map((row) => row.target_dimensions.find((candidate) => candidate.key === key)?.value)
            .filter(Boolean),
        );
        if (differs && values.size > 1) expect(facets).toContain(key);
      }
    }),
    params,
  );
});
