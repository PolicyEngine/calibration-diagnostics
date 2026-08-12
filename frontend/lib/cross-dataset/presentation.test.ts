import { expect, test } from "bun:test";

import type {
  CrossDatasetGroup,
  CrossDatasetSummary,
} from "./artifact";
import {
  CROSS_DATASET_PAGE_TITLE,
  GROUP_DIMENSIONS,
  buildGroupRows,
  buildSourceOverviews,
  crossDatasetUiState,
  groupFactsHref,
  orderSourceSummaries,
  sourceCompactLabel,
  sourceDisplayLabel,
} from "./presentation";

const summary: CrossDatasetSummary = {
  schema_version: "cross_dataset.frontend_bundle.v1",
  run_id: "evaluation-test",
  snapshot_id: "ledger-test",
  fact_count: 48_313,
  matrix_complete: true,
  sources: [
    {
      source_id: "microcosm",
      label: "Microcosm + PolicyEngine-US",
      source_type: "model_dataset_pair",
      capability_count: 48_313,
      result_count: 9_411,
      score: {
        covered: 9_411,
        scored: 9_411,
        relative_error_count: 9_400,
        display_score: "92.4338661514",
        loss: "0.1513226769",
      },
      performance_buckets: {
        within_bounds: 8_000,
        outside_bounds: 900,
        far_outside_bounds: 511,
        unavailable: 38_902,
        total: 48_313,
      },
      capability_statuses: {
        evaluable_direct: 9_259,
        evaluable_in_sample: 36,
        evaluable_projected: 116,
        unsupported_concept: 29_051,
        unsupported_period: 6_689,
      },
      reason_codes: {
        mapping_not_found: 29_051,
        period_not_supported: 6_689,
      },
      period_treatments: {
        native: 9_295,
        aligned_fact: 116,
        unsupported: 38_902,
      },
      dataset_version: "microcosm-2024",
      model_version: "policyengine-us==1.0",
    },
    {
      source_id: "cps",
      label: "Public CPS + Tax-Calculator",
      source_type: "model_dataset_pair",
      capability_count: 48_313,
      result_count: 38,
      score: {
        covered: 38,
        scored: 38,
        relative_error_count: 38,
        display_score: "91.2164300165",
        loss: "0.1756713997",
      },
      performance_buckets: {
        within_bounds: 25,
        outside_bounds: 8,
        far_outside_bounds: 5,
        unavailable: 48_275,
        total: 48_313,
      },
      capability_statuses: {
        evaluable_direct: 5,
        evaluable_via_model: 33,
        unsupported_geography: 44_844,
      },
      reason_codes: {
        geography_not_supported: 44_844,
        period_not_supported: 1_069,
      },
      period_treatments: {
        advanced_population: 38,
        unsupported: 48_275,
      },
      dataset_version: "taxcalc-cps-2014@6.7.1",
      model_version: "taxcalc==6.7.1",
    },
  ],
};

const groups: CrossDatasetGroup[] = [
  {
    dimension: "geography",
    key: "state",
    label: "State",
    fact_count: 12_000,
    sources: {
      microcosm: {
        evaluable: 5_000,
        scored: 5_000,
        relative_error_count: 4_990,
        display_score: "88",
        loss: "0.12",
        performance_buckets: {
          within_bounds: 4_000,
          outside_bounds: 600,
          far_outside_bounds: 390,
          unavailable: 7_010,
          total: 12_000,
        },
        reason_codes: { mapping_not_found: 7_000 },
      },
      cps: {
        evaluable: 0,
        scored: 0,
        relative_error_count: 0,
        display_score: null,
        loss: null,
        performance_buckets: {
          within_bounds: 0,
          outside_bounds: 0,
          far_outside_bounds: 0,
          unavailable: 12_000,
          total: 12_000,
        },
        reason_codes: { geography_not_supported: 12_000 },
      },
    },
  },
  {
    dimension: "geography_microcosm_calibration_sample",
    key: "state|in_sample",
    label: "State / In sample",
    fact_count: 2_000,
    sources: {
      microcosm: {
        evaluable: 2_000,
        scored: 2_000,
        relative_error_count: 1_999,
        display_score: "97",
        loss: "0.03",
        performance_buckets: {
          within_bounds: 1_900,
          outside_bounds: 80,
          far_outside_bounds: 19,
          unavailable: 1,
          total: 2_000,
        },
        reason_codes: {},
      },
      cps: {
        evaluable: 0,
        scored: 0,
        relative_error_count: 0,
        display_score: null,
        loss: null,
        performance_buckets: {
          within_bounds: 0,
          outside_bounds: 0,
          far_outside_bounds: 0,
          unavailable: 2_000,
          total: 2_000,
        },
        reason_codes: {},
      },
    },
  },
  {
    dimension: "microcosm_calibration_sample",
    key: "in_sample",
    label: "In sample",
    fact_count: 2_000,
    sources: {
      microcosm: {
        evaluable: 2_000,
        scored: 2_000,
        relative_error_count: 1_999,
        display_score: "97",
        loss: "0.03",
        performance_buckets: {
          within_bounds: 1_900,
          outside_bounds: 80,
          far_outside_bounds: 19,
          unavailable: 1,
          total: 2_000,
        },
        reason_codes: {},
      },
      cps: {
        evaluable: 0,
        scored: 0,
        relative_error_count: 0,
        display_score: null,
        loss: null,
        performance_buckets: {
          within_bounds: 0,
          outside_bounds: 0,
          far_outside_bounds: 0,
          unavailable: 2_000,
          total: 2_000,
        },
        reason_codes: {},
      },
    },
  },
  {
    dimension: "microcosm_calibration_sample",
    key: "out_of_sample",
    label: "Out of sample",
    fact_count: 46_313,
    sources: {
      microcosm: {
        evaluable: 7_411,
        scored: 7_411,
        relative_error_count: 7_401,
        display_score: "89",
        loss: "0.18",
        performance_buckets: {
          within_bounds: 6_100,
          outside_bounds: 820,
          far_outside_bounds: 481,
          unavailable: 38_912,
          total: 46_313,
        },
        reason_codes: { mapping_not_found: 29_051 },
      },
      cps: {
        evaluable: 38,
        scored: 38,
        relative_error_count: 38,
        display_score: "91.2164",
        loss: "0.175672",
        performance_buckets: {
          within_bounds: 25,
          outside_bounds: 8,
          far_outside_bounds: 5,
          unavailable: 46_275,
          total: 46_313,
        },
        reason_codes: { geography_not_supported: 44_844 },
      },
    },
  },
  {
    dimension: "ledger_source",
    key: "irs_soi",
    label: "IRS SOI",
    fact_count: 33_045,
    sources: {
      microcosm: {
        evaluable: 150,
        scored: 150,
        relative_error_count: 149,
        display_score: "96.4982",
        loss: "0.070036",
        performance_buckets: {
          within_bounds: 100,
          outside_bounds: 30,
          far_outside_bounds: 20,
          unavailable: 32_895,
          total: 33_045,
        },
        reason_codes: { mapping_not_found: 26_893, period_not_supported: 6_002 },
      },
      cps: {
        evaluable: 37,
        scored: 37,
        relative_error_count: 37,
        display_score: "90.5504",
        loss: "0.188992",
        performance_buckets: {
          within_bounds: 20,
          outside_bounds: 10,
          far_outside_bounds: 7,
          unavailable: 33_008,
          total: 33_045,
        },
        reason_codes: { geography_not_supported: 31_873, period_not_supported: 1_069 },
      },
    },
  },
  {
    dimension: "period_treatment",
    key: "aligned_fact",
    label: "Aligned fact",
    fact_count: 116,
    sources: {
      microcosm: {
        evaluable: 116,
        scored: 116,
        relative_error_count: 116,
        display_score: "94.0919",
        loss: "0.118162",
        performance_buckets: {
          within_bounds: 100,
          outside_bounds: 10,
          far_outside_bounds: 6,
          unavailable: 0,
          total: 116,
        },
        reason_codes: {},
      },
      cps: {
        evaluable: 0,
        scored: 0,
        relative_error_count: 0,
        display_score: null,
        loss: null,
        performance_buckets: {
          within_bounds: 0,
          outside_bounds: 0,
          far_outside_bounds: 0,
          unavailable: 0,
          total: 0,
        },
        reason_codes: {},
      },
    },
  },
  {
    dimension: "period_treatment",
    key: "advanced_population",
    label: "Advanced population",
    fact_count: 38,
    sources: {
      microcosm: {
        evaluable: 0,
        scored: 0,
        relative_error_count: 0,
        display_score: null,
        loss: null,
        performance_buckets: {
          within_bounds: 0,
          outside_bounds: 0,
          far_outside_bounds: 0,
          unavailable: 0,
          total: 0,
        },
        reason_codes: {},
      },
      cps: {
        evaluable: 38,
        scored: 38,
        relative_error_count: 38,
        display_score: "91.2164",
        loss: "0.175672",
        performance_buckets: {
          within_bounds: 25,
          outside_bounds: 8,
          far_outside_bounds: 5,
          unavailable: 0,
          total: 38,
        },
        reason_codes: {},
      },
    },
  },
  {
    dimension: "calibration_exposure",
    key: "direct_calibration_target",
    label: "Direct calibration target",
    fact_count: 152,
    sources: {
      microcosm: {
        evaluable: 152,
        scored: 152,
        relative_error_count: 152,
        display_score: "96.5802",
        loss: "0.068396",
        performance_buckets: {
          within_bounds: 120,
          outside_bounds: 20,
          far_outside_bounds: 12,
          unavailable: 0,
          total: 152,
        },
        reason_codes: {},
      },
      cps: {
        evaluable: 0,
        scored: 0,
        relative_error_count: 0,
        display_score: null,
        loss: null,
        performance_buckets: {
          within_bounds: 0,
          outside_bounds: 0,
          far_outside_bounds: 0,
          unavailable: 0,
          total: 0,
        },
        reason_codes: {},
      },
    },
  },
  {
    dimension: "calibration_exposure",
    key: "external_validation",
    label: "External validation",
    fact_count: 9_297,
    sources: {
      microcosm: {
        evaluable: 9_259,
        scored: 9_259,
        relative_error_count: 9_248,
        display_score: "89.4248",
        loss: "0.211504",
        performance_buckets: {
          within_bounds: 8_000,
          outside_bounds: 800,
          far_outside_bounds: 459,
          unavailable: 38,
          total: 9_297,
        },
        reason_codes: {},
      },
      cps: {
        evaluable: 38,
        scored: 38,
        relative_error_count: 38,
        display_score: "91.2164",
        loss: "0.175672",
        performance_buckets: {
          within_bounds: 25,
          outside_bounds: 8,
          far_outside_bounds: 5,
          unavailable: 0,
          total: 38,
        },
        reason_codes: {},
      },
    },
  },
];

test("keeps the page title and exposes only the requested group controls", () => {
  expect(CROSS_DATASET_PAGE_TITLE).toBe("Cross-dataset comparison");
  expect(GROUP_DIMENSIONS).toEqual([
    { key: "ledger_source", label: "Chronicle source" },
    { key: "period", label: "Period" },
    { key: "geography", label: "Geography" },
  ]);
});

test("classifies loading, error, empty, and ready overview states", () => {
  expect(crossDatasetUiState({ isLoading: true })).toBe("loading");
  expect(crossDatasetUiState({ error: new Error("offline") })).toBe("error");
  expect(
    crossDatasetUiState({
      summary: { ...summary, sources: [] },
    }),
  ).toBe("empty");
  expect(crossDatasetUiState({ summary })).toBe("ready");
});

test("source metric rows keep performance inseparable from Chronicle coverage counts", () => {
  const cards = buildSourceOverviews(summary, groups);
  const microcosm = cards[0];
  const cps = cards[1];

  expect(microcosm.scoreLabel).toBe("15.1% mean error");
  expect(microcosm.coverageRateLabel).toBe("19.5% coverage");
  expect(microcosm.label).toBe("Microcosm + PolicyEngine-US");
  expect(microcosm.coverageLabel).toBe("9,411 of 48,313 facts");
  expect(microcosm.scoreScopeLabel).toBe("Mean capped error across 9,400 comparable facts");
  expect(microcosm.performanceBuckets).toEqual({
    withinBounds: 8_000,
    outsideBounds: 900,
    farOutsideBounds: 511,
    unavailable: 38_902,
    total: 48_313,
  });
  expect("coveragePercent" in microcosm).toBe(false);

  expect(cps.scoreLabel).toBe("17.6% mean error");
  expect(cps.coverageRateLabel).toBe("0.1% coverage");
  expect(cps.coverageLabel).toBe("38 of 48,313 facts");
  expect(cps.scoreScopeLabel).toBe("Mean capped error across 38 comparable facts");
  expect(cps.unsupportedCount).toBe(48_275);
  expect(cps.topUnsupportedReasons[0]).toEqual({
    key: "geography_not_supported",
    label: "Geography not supported",
    count: 44_844,
  });
});

test("legacy Tax-Calculator artifacts display the current Public CPS label", () => {
  expect(
    sourceDisplayLabel({
      ...summary.sources[1],
      source_id: "taxcalc_public_cps_2024",
      label: "Tax-Calculator + public CPS",
    }),
  ).toBe("Public CPS + Tax-Calculator");
});

test("compact source labels fit the group comparison matrix", () => {
  const rawAcs = {
    ...summary.sources[1],
    source_id: "census_acs_pums_2024",
    label: "Raw ACS PUMS",
  };
  const yale = {
    ...summary.sources[1],
    source_id: "yale_reconstruction_2024",
    label: "Yale Tax-Data + Tax-Simulator (reconstruction)",
  };

  expect(sourceCompactLabel(summary.sources[0])).toBe("Microcosm");
  expect(sourceCompactLabel(summary.sources[1])).toBe("Public CPS");
  expect(sourceCompactLabel(yale)).toBe("Yale reconstruction");
  expect(sourceCompactLabel(rawAcs)).toBe("Raw ACS");
});

test("orders Microcosm, Public CPS, Yale reconstruction, then Raw ACS", () => {
  const rawAcs = {
    ...summary.sources[1],
    source_id: "census_acs_pums_2024",
    label: "Raw ACS PUMS",
  };
  const yale = {
    ...summary.sources[1],
    source_id: "yale_reconstruction_2024",
    label: "Yale Tax-Data + Tax-Simulator (reconstruction)",
  };
  const mixedSources = [rawAcs, yale, ...summary.sources];

  expect(orderSourceSummaries(mixedSources).map((source) => source.source_id)).toEqual([
    "microcosm",
    "cps",
    "yale_reconstruction_2024",
    "census_acs_pums_2024",
  ]);
  expect(
    buildSourceOverviews({ ...summary, sources: mixedSources }, groups).map(
      (source) => source.sourceId,
    ),
  ).toEqual([
    "microcosm",
    "cps",
    "yale_reconstruction_2024",
    "census_acs_pums_2024",
  ]);
});

test("shared metric filters select the same geography and sample for every source", () => {
  const geography = buildSourceOverviews(summary, groups, {
    geography: "state",
    sample: "all",
  });
  expect(geography[0].scoreLabel).toBe("12.0% mean error");
  expect(geography[0].coverageRateLabel).toBe("41.7% coverage");
  expect(geography[0].performanceBuckets.total).toBe(12_000);
  expect(geography[1].scoreLabel).toBe("Not scored");
  expect(geography[1].coverageRateLabel).toBe("0.0% coverage");
  expect(geography[1].performanceBuckets.total).toBe(12_000);

  const inSampleState = buildSourceOverviews(summary, groups, {
    geography: "state",
    sample: "in_sample",
  });
  expect(inSampleState[0].scoreLabel).toBe("3.0% mean error");
  expect(inSampleState[0].coverageRateLabel).toBe("100.0% coverage");
  expect(inSampleState[0].performanceBuckets).toEqual({
    withinBounds: 1_900,
    outsideBounds: 80,
    farOutsideBounds: 19,
    unavailable: 1,
    total: 2_000,
  });
  expect(inSampleState[1].scoreLabel).toBe("Not scored");
  expect(inSampleState[1].coverageRateLabel).toBe("0.0% coverage");
  expect(inSampleState[1].performanceBuckets.total).toBe(2_000);

  const outOfSample = buildSourceOverviews(summary, groups, {
    geography: "all",
    sample: "out_of_sample",
  });
  expect(outOfSample[0].scoreLabel).toBe("18.0% mean error");
  expect(outOfSample[1].scoreLabel).toBe("17.6% mean error");
  expect(outOfSample[1].performanceBuckets.total).toBe(46_313);

  const emptyIntersection = buildSourceOverviews(summary, groups, {
    geography: "congressional_district",
    sample: "in_sample",
  });
  expect(
    emptyIntersection.every(
      (source) =>
        source.scoreLabel === "Not scored" &&
        source.coverageRateLabel === "0.0% coverage" &&
        source.performanceBuckets.total === 0,
    ),
  ).toBe(true);
});

test("source scorecards identify aligned, advanced, and in-sample comparisons", () => {
  const cards = buildSourceOverviews(summary, groups);
  const microcosm = cards[0];
  const cps = cards[1];

  expect(microcosm.periodTreatments).toContainEqual({
    key: "aligned_fact",
    label: "Chronicle facts transformed to model-comparable benchmarks",
    count: 116,
  });
  expect(microcosm.calibrationExposures).toContainEqual({
    key: "direct_calibration_target",
    label: "Direct calibration targets (in-sample)",
    count: 152,
  });
  expect(cps.periodTreatments).toContainEqual({
    key: "advanced_population",
    label: "CPS population advanced to 2024",
    count: 38,
  });
  expect(cps.calibrationExposures).toContainEqual({
    key: "external_validation",
    label: "External validation",
    count: 38,
  });
});

test("group rows expose score, coverage, unsupported counts, and fact links", () => {
  const rows = buildGroupRows(groups, "ledger_source", summary.sources);
  expect(rows).toHaveLength(1);
  expect(rows[0].label).toBe("IRS Statistics of Income");
  expect(rows[0].sources.microcosm).toMatchObject({
    scoreLabel: "7.0% mean error",
    coverageRateLabel: "0.5% coverage",
    coverageLabel: "150 / 33,045",
    unsupportedCount: 32_895,
    performanceBuckets: {
      withinBounds: 100,
      outsideBounds: 30,
      farOutsideBounds: 20,
      unavailable: 32_895,
      total: 33_045,
    },
  });
  expect(rows[0].sources.cps).toMatchObject({
    scoreLabel: "18.9% mean error",
    coverageRateLabel: "0.1% coverage",
    coverageLabel: "37 / 33,045",
    unsupportedCount: 33_008,
  });
  expect(rows[0].sources.cps.factHref).toBe(
    "/microcosm/datasets?view=facts&source=cps&ledger_source=irs_soi",
  );
  expect("coveragePercent" in rows[0].sources.microcosm).toBe(false);
});

test("every supported grouping maps to a stable fact-catalog URL", () => {
  expect(groupFactsHref("concept", "irs_soi.wages", "cps")).toBe(
    "/microcosm/datasets?view=facts&source=cps&measure=irs_soi.wages",
  );
  expect(groupFactsHref("period", "tax_year:2024", "cps")).toBe(
    "/microcosm/datasets?view=facts&source=cps&period=tax_year%3A2024",
  );
  expect(groupFactsHref("geography", "country", "cps")).toBe(
    "/microcosm/datasets?view=facts&source=cps&geography=country",
  );
  expect(groupFactsHref("period_treatment", "advanced_population", "cps")).toBe(
    "/microcosm/datasets?view=facts&source=cps&period_treatment=advanced_population",
  );
  expect(groupFactsHref("calibration_exposure", "external_validation", "cps")).toBe(
    "/microcosm/datasets?view=facts&source=cps&calibration_exposure=external_validation",
  );
});
