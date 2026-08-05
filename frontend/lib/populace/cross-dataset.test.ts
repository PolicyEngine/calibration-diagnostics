import { expect, test } from "bun:test";

import {
  conceptBreakdown,
  scoreDataset,
  cappedError,
  relError,
  median,
  type NationalTarget,
  type DatasetInput,
} from "./cross-dataset";

const targets: NationalTarget[] = [
  { name: "agi_total", target: 1000, populace: 1100, source: "irs_soi", variable: "agi", measure: "total" },
  { name: "agi_count", target: 100, populace: 90, source: "irs_soi", variable: "agi", measure: "count" },
  { name: "eitc_total", target: 200, populace: 260, source: "irs_soi", variable: "eitc", measure: "total" },
  { name: "snap_total", target: 500, populace: 480, source: "usda_snap", variable: "snap", measure: "total" },
  { name: "zero_bench", target: 0, populace: 5, source: "irs_soi", variable: "x", measure: "total" },
];

test("relError guards null and zero benchmark", () => {
  expect(relError(110, 100)).toBeCloseTo(0.1, 9);
  expect(relError(5, 0)).toBeNull();
  expect(relError(null, 100)).toBeNull();
});

test("cappedError winsorizes at 200%", () => {
  expect(cappedError(0.4)).toBe(0.4);
  expect(cappedError(5)).toBe(2.0);
});

test("populace loss is capped-MAPE over targets with a nonzero official value", () => {
  const populace: DatasetInput = { label: "populace", value: (t) => t.populace };
  const s = scoreDataset(targets, populace);
  // Covered = 4 (zero-benchmark row excluded — no relative error there).
  expect(s.covered).toBe(4);
  // |err|: agi_total .1, agi_count .1, eitc_total .3, snap .04
  expect(s.median).toBeCloseTo(0.1, 9);
  expect(s.within10).toBe(3); // .1, .1, .04 are <= .1 (eitc .3 is not)
  expect(s.loss).toBeCloseTo((0.1 + 0.1 + 0.3 + 0.04) / 4, 9);
});

test("an external federal-tax engine covers only the concepts it can express", () => {
  // taxcalc-like dataset: expresses the SOI tax rows, not SNAP, and misses one.
  const values: Record<string, number> = { agi_total: 1200, eitc_total: 210 };
  const taxcalc: DatasetInput = { label: "taxcalc", value: (t) => values[t.name] };
  const s = scoreDataset(targets, taxcalc);
  expect(s.covered).toBe(2); // agi_total + eitc_total only
  // |err|: agi 0.2, eitc 0.05
  expect(s.within10).toBe(1);
  expect(s.loss).toBeCloseTo((0.2 + 0.05) / 2, 9);
});

test("concept breakdown groups by variable × measure and scores each dataset", () => {
  const populace: DatasetInput = { label: "populace", value: (t) => t.populace };
  const taxcalc: DatasetInput = {
    label: "taxcalc",
    value: (t) => ({ agi_total: 1200, eitc_total: 210 } as Record<string, number>)[t.name],
  };
  const groups = conceptBreakdown(targets, [populace, taxcalc]);
  // 5 concepts: agi·total, agi·count, eitc·total, snap·total, x·total
  expect(groups.length).toBe(5);
  const agiTotal = groups.find((g) => g.key === "agi · total")!;
  expect(agiTotal.cells).toBe(1);
  expect(agiTotal.scores.populace.covered).toBe(1);
  expect(agiTotal.scores.taxcalc.covered).toBe(1);
  expect(agiTotal.scores.taxcalc.loss).toBeCloseTo(0.2, 9);
  // taxcalc cannot express snap.
  const snap = groups.find((g) => g.key === "snap · total")!;
  expect(snap.scores.taxcalc.covered).toBe(0);
  expect(snap.scores.taxcalc.loss).toBeNull();
});

test("median helper handles even and odd lengths", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
  expect(median([])).toBeNull();
});
