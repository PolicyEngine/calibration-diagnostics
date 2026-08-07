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
} from "./presentation";

const summary: CrossDatasetSummary = {
  schema_version: "cross_dataset.frontend_bundle.v1",
  run_id: "evaluation-test",
  snapshot_id: "ledger-test",
  fact_count: 48_313,
  matrix_complete: true,
  sources: [
    {
      source_id: "populace",
      label: "Populace + PolicyEngine-US",
      source_type: "model_dataset_pair",
      capability_count: 48_313,
      result_count: 9_411,
      score: {
        covered: 9_411,
        scored: 9_411,
        display_score: "92.4338661514",
        loss: "0.1513226769",
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
      dataset_version: "populace-2024",
      model_version: "policyengine-us==1.0",
    },
    {
      source_id: "cps",
      label: "Tax-Calculator + public CPS",
      source_type: "model_dataset_pair",
      capability_count: 48_313,
      result_count: 38,
      score: {
        covered: 38,
        scored: 38,
        display_score: "91.2164300165",
        loss: "0.1756713997",
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
    dimension: "ledger_source",
    key: "irs_soi",
    label: "IRS SOI",
    fact_count: 33_045,
    sources: {
      populace: {
        evaluable: 150,
        scored: 150,
        display_score: "96.4982",
        reason_codes: { mapping_not_found: 26_893, period_not_supported: 6_002 },
      },
      cps: {
        evaluable: 37,
        scored: 37,
        display_score: "90.5504",
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
      populace: {
        evaluable: 116,
        scored: 116,
        display_score: "94.0919",
        reason_codes: {},
      },
      cps: {
        evaluable: 0,
        scored: 0,
        display_score: null,
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
      populace: {
        evaluable: 0,
        scored: 0,
        display_score: null,
        reason_codes: {},
      },
      cps: {
        evaluable: 38,
        scored: 38,
        display_score: "91.2164",
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
      populace: {
        evaluable: 152,
        scored: 152,
        display_score: "96.5802",
        reason_codes: {},
      },
      cps: {
        evaluable: 0,
        scored: 0,
        display_score: null,
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
      populace: {
        evaluable: 9_259,
        scored: 9_259,
        display_score: "89.4248",
        reason_codes: {},
      },
      cps: {
        evaluable: 38,
        scored: 38,
        display_score: "91.2164",
        reason_codes: {},
      },
    },
  },
];

test("keeps the existing page title", () => {
  expect(CROSS_DATASET_PAGE_TITLE).toBe("Cross-dataset comparison");
  expect(GROUP_DIMENSIONS[0]).toEqual({
    key: "ledger_source",
    label: "Chronicle source",
  });
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
  const populace = cards[0];
  const cps = cards[1];

  expect(populace.scoreLabel).toBe("92.4 / 100");
  expect(populace.label).toBe("Microcosm + PolicyEngine-US");
  expect(populace.coverageLabel).toBe("9,411 of 48,313 facts");
  expect(populace.scoreScopeLabel).toBe("Performance among 9,411 scored facts");
  expect(populace.performancePercent).toBeCloseTo(92.4339, 3);
  expect("coveragePercent" in populace).toBe(false);

  expect(cps.scoreLabel).toBe("91.2 / 100");
  expect(cps.coverageLabel).toBe("38 of 48,313 facts");
  expect(cps.scoreScopeLabel).toBe("Performance among 38 scored facts");
  expect(cps.unsupportedCount).toBe(48_275);
  expect(cps.topUnsupportedReasons[0]).toEqual({
    key: "geography_not_supported",
    label: "Geography not supported",
    count: 44_844,
  });
});

test("Microcosm is ordered before every other model or standalone dataset", () => {
  const reversedSources = [...summary.sources].reverse();

  expect(orderSourceSummaries(reversedSources).map((source) => source.source_id)).toEqual([
    "populace",
    "cps",
  ]);
  expect(
    buildSourceOverviews({ ...summary, sources: reversedSources }, groups).map(
      (source) => source.sourceId,
    ),
  ).toEqual(["populace", "cps"]);
});

test("source scorecards identify aligned, advanced, and in-sample comparisons", () => {
  const cards = buildSourceOverviews(summary, groups);
  const populace = cards[0];
  const cps = cards[1];

  expect(populace.periodTreatments).toContainEqual({
    key: "aligned_fact",
    label: "2023 facts aligned to 2024",
    count: 116,
  });
  expect(populace.calibrationExposures).toContainEqual({
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
  expect(rows[0].sources.populace).toMatchObject({
    scoreLabel: "96.5",
    coverageLabel: "150 / 33,045",
    unsupportedCount: 32_895,
  });
  expect(rows[0].sources.cps).toMatchObject({
    scoreLabel: "90.6",
    coverageLabel: "37 / 33,045",
    unsupportedCount: 33_008,
  });
  expect(rows[0].sources.cps.factHref).toBe(
    "/populace/datasets?view=facts&source=cps&ledger_source=irs_soi",
  );
  expect("coveragePercent" in rows[0].sources.populace).toBe(false);
});

test("every supported grouping maps to a stable fact-catalog URL", () => {
  expect(groupFactsHref("concept", "irs_soi.wages", "cps")).toBe(
    "/populace/datasets?view=facts&source=cps&measure=irs_soi.wages",
  );
  expect(groupFactsHref("period", "tax_year:2024", "cps")).toBe(
    "/populace/datasets?view=facts&source=cps&period=tax_year%3A2024",
  );
  expect(groupFactsHref("geography", "country", "cps")).toBe(
    "/populace/datasets?view=facts&source=cps&geography=country",
  );
  expect(groupFactsHref("period_treatment", "advanced_population", "cps")).toBe(
    "/populace/datasets?view=facts&source=cps&period_treatment=advanced_population",
  );
  expect(groupFactsHref("calibration_exposure", "external_validation", "cps")).toBe(
    "/populace/datasets?view=facts&source=cps&calibration_exposure=external_validation",
  );
});
